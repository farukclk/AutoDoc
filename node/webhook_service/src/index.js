require('dotenv').config();
const express = require('express');
const amqp = require('amqplib');
const { Octokit } = require('@octokit/rest');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_NAME = 'CodeFetched';

let channel = null;

// Connect to RabbitMQ
async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log(`[Webhook Service] Connected to RabbitMQ. Queue '${QUEUE_NAME}' is ready.`);
    } catch (error) {
        console.error('[Webhook Service] Failed to connect to RabbitMQ:', error.message);
        setTimeout(connectRabbitMQ, 5000); // Retry connection
    }
}
connectRabbitMQ();

// Initialize Octokit
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

app.post('/webhook', async (req, res) => {
    try {
        // We only care about push events
        const eventType = req.headers['x-github-event'];
        if (eventType !== 'push') {
            return res.status(200).send('Event ignored, only push events are handled.');
        }

        const payload = req.body;
        const repoFullName = payload.repository.full_name; // e.g., "username/repo"
        const commits = payload.commits || [];
        const owner = repoFullName.split('/')[0];
        const repo = repoFullName.split('/')[1];

        const filePatches = {}; // Map of filename -> combined patch

        for (const commit of commits) {
            try {
                const commitInfo = await octokit.rest.repos.getCommit({
                    owner,
                    repo,
                    ref: commit.id
                });
                
                if (commitInfo.data.files) {
                    for (const file of commitInfo.data.files) {
                        if (['added', 'modified'].includes(file.status) && file.patch) {
                            filePatches[file.filename] = (filePatches[file.filename] || '') + '\n' + file.patch;
                        }
                    }
                }
            } catch (err) {
                console.error(`[Webhook Service] Failed to get commit ${commit.id}:`, err.message);
            }
        }

        const changedFilesCount = Object.keys(filePatches).length;
        if (changedFilesCount === 0) {
            return res.status(200).send('No files added or modified, or no patches found.');
        }

        const changesList = Object.entries(filePatches).map(([filename, patch]) => ({
            filename,
            patch
        }));

        // Fetch existing autodoc.md
        let existingDoc = '';
        try {
            const docResponse = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: 'autodoc.md',
            });
            if (docResponse.data.type === 'file' && docResponse.data.content) {
                existingDoc = Buffer.from(docResponse.data.content, 'base64').toString('utf8');
            }
        } catch (error) {
            if (error.status !== 404) {
                console.error('[Webhook Service] Error fetching existing autodoc.md:', error.message);
            }
        }

        const message = {
            repoUrl: payload.repository.html_url,
            repoFullName: repoFullName,
            changes: changesList,
            existingDoc: existingDoc,
            timestamp: new Date().toISOString()
        };

        if (channel) {
            channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), { persistent: true });
            console.log(`[Webhook Service] Sent batch of ${changedFilesCount} files to queue.`);
        } else {
            console.error('[Webhook Service] RabbitMQ channel is not available.');
        }

        res.status(200).send('Webhook processed successfully.');

    } catch (error) {
        console.error('[Webhook Service] Error processing webhook:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(PORT, () => {
    console.log(`[Webhook Service] Listening on port ${PORT}`);
});
