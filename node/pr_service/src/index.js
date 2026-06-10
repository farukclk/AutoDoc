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

        // 1. Get the default branch (usually main or master)
        const repoInfo = await octokit.rest.repos.get({
            owner,
            repo
        });
        const defaultBranch = repoInfo.data.default_branch;

        // 2. Get the commit SHA of the default branch
        const refInfo = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${defaultBranch}`
        });
        const baseSha = refInfo.data.object.sha;

        // 3. Create a new branch
        const newBranchName = `autodoc-update-${Date.now()}`;
        await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${newBranchName}`,
            sha: baseSha
        });

        // 4. Check if autodoc.md already exists to get its file SHA (needed for updating)
        let fileSha = null;
        let existingContent = '';
        try {
            const fileInfo = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: docFileName,
                ref: newBranchName
            });
            fileSha = fileInfo.data.sha;
            existingContent = Buffer.from(fileInfo.data.content, 'base64').toString('utf8');
        } catch (error) {
            if (error.status !== 404) {
                throw error;
            }
            // File does not exist, which is fine
        }

        // 5. Create or Update the file in the new branch
        const newContent = existingContent
            ? `${existingContent}\n\n---\n\n${markdownContent}`
            : markdownContent;

        await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: docFileName,
            message: 'docs: Update autodoc.md with latest AI generated docs',
            content: Buffer.from(newContent).toString('base64'),
            branch: newBranchName,
            sha: fileSha || undefined // sha is required if updating an existing file
        });

        // 6. Create a Pull Request
        const prResponse = await octokit.rest.pulls.create({
            owner,
            repo,
            title: 'docs: AutoDoc AI Documentation Update',
            head: newBranchName,
            base: defaultBranch,
            body: 'This is an automated pull request created by AutoDoc pipeline to update the documentation.'
        });

        console.log(`[PR Service] Successfully opened PR: ${prResponse.data.html_url}`);
        res.status(200).json({
            message: 'Pull Request created successfully',
            prUrl: prResponse.data.html_url
        });

    } catch (error) {
        console.error('[PR Service] Error creating PR:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(PORT, () => {
    console.log(`[PR Service] Listening on port ${PORT}`);
});
