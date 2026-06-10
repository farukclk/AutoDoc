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

        // Collect all added and modified files
        const changedFiles = new Set();
        for (const commit of commits) {
            commit.added.forEach(f => changedFiles.add(f));
            commit.modified.forEach(f => changedFiles.add(f));
        }

        if (changedFiles.size === 0) {
            return res.status(200).send('No files added or modified.');
        }

        const owner = repoFullName.split('/')[0];
        const repo = repoFullName.split('/')[1];

        // Process each changed file
        for (const filePath of changedFiles) {
            // Fetch raw file content using GitHub API
            const response = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: filePath,
            });

            // The content is base64 encoded
            if (response.data.type === 'file' && response.data.content) {
                const rawContent = Buffer.from(response.data.content, 'base64').toString('utf8');

                // Prepare message for RabbitMQ
                const message = {
                    repoUrl: payload.repository.html_url,
                    repoFullName: repoFullName,
                    filePath: filePath,
                    content: rawContent,
                    timestamp: new Date().toISOString()
                };

                // Send to RabbitMQ
                if (channel) {
                    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), { persistent: true });
                    console.log(`[Webhook Service] Sent file '${filePath}' to queue.`);
                } else {
                    console.error('[Webhook Service] RabbitMQ channel is not available.');
                }
            }
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
