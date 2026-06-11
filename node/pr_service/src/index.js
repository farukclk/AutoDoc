require('dotenv').config();
const express = require('express');
const { Octokit } = require('@octokit/rest');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Initialize Octokit
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

app.post('/publish', async (req, res) => {
    try {
        const { repoFullName, markdownContent } = req.body;

        if (!repoFullName || !markdownContent) {
            return res.status(400).send('Missing repoFullName or markdownContent in body');
        }

        const [owner, repo] = repoFullName.split('/');
        const docFileName = 'autodoc.md';

        // 1. Get authenticated user (bot)
        const authUser = await octokit.rest.users.getAuthenticated();
        const botUser = authUser.data.login;

        let targetOwner = botUser;
        let targetRepo = `${repo}.AutoDoc.Fork`;
        let targetBranch = 'main';

        // 2. Fork the repository
        try {
            const forkRes = await octokit.rest.repos.createFork({
                owner,
                repo,
                name: targetRepo,
                default_branch_only: true
            });
            targetBranch = forkRes.data.default_branch || 'main';
        } catch (e) {
            console.error('[PR Service] Error creating fork:', e.message);
            return res.status(500).send('Error creating fork');
        }

        // Wait for fork to be ready
        let isReady = false;
        for (let i = 0; i < 15; i++) {
            try {
                await octokit.rest.repos.get({ owner: targetOwner, repo: targetRepo });
                isReady = true;
                break;
            } catch (e) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!isReady) {
            return res.status(500).send('Fork was not ready in time.');
        }

        // 3. Sync fork with upstream
        try {
            await octokit.rest.repos.mergeUpstream({
                owner: targetOwner,
                repo: targetRepo,
                branch: targetBranch
            });
            console.log('[PR Service] Synced fork with upstream.');
        } catch (e) {
            console.log('[PR Service] Sync upstream info:', e.message);
        }

        // 4. Check if autodoc.md already exists
        let fileSha = null;
        let existingContent = '';
        try {
            const fileInfo = await octokit.rest.repos.getContent({
                owner: targetOwner,
                repo: targetRepo,
                path: docFileName,
                ref: targetBranch
            });
            fileSha = fileInfo.data.sha;
            existingContent = Buffer.from(fileInfo.data.content, 'base64').toString('utf8');
        } catch (error) {
            if (error.status !== 404) {
                throw error;
            }
        }

        // 5. Create or Update the file
        // Clean markdown content from potential ```markdown blocks if Gemini added them
        let finalContent = markdownContent.trim();
        if (finalContent.startsWith('```markdown')) {
            finalContent = finalContent.substring(11).replace(/```$/, '').trim();
        } else if (finalContent.startsWith('```')) {
            finalContent = finalContent.substring(3).replace(/```$/, '').trim();
        }

        const newContent = finalContent;

        await octokit.rest.repos.createOrUpdateFileContents({
            owner: targetOwner,
            repo: targetRepo,
            path: docFileName,
            message: 'docs: Update autodoc.md with latest AI generated docs',
            content: Buffer.from(newContent).toString('base64'),
            branch: targetBranch,
            sha: fileSha || undefined
        });

        // 6. Create a Pull Request (or update existing)
        try {
            const upstreamInfo = await octokit.rest.repos.get({ owner, repo });
            const upstreamDefaultBranch = upstreamInfo.data.default_branch;

            const prResponse = await octokit.rest.pulls.create({
                owner,
                repo,
                title: 'docs: AutoDoc AI Documentation Update',
                head: `${targetOwner}:${targetBranch}`,
                base: upstreamDefaultBranch,
                body: 'This is an automated pull request created by AutoDoc pipeline to update the documentation. Any further pushes will update this PR automatically.'
            });

            console.log(`[PR Service] Successfully opened PR: ${prResponse.data.html_url}`);
            res.status(200).json({
                message: 'Pull Request created successfully',
                prUrl: prResponse.data.html_url
            });
        } catch (error) {
            if (error.message.includes('A pull request already exists')) {
                console.log('[PR Service] PR already exists. It has been updated automatically by the branch push.');
                res.status(200).json({ message: 'PR already exists and was updated.' });
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error('[PR Service] Error handling webhook:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(PORT, () => {
    console.log(`[PR Service] Listening on port ${PORT}`);
});
