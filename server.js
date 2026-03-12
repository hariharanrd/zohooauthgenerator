require('dotenv').config();
const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3333;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Config endpoint: exposes extra data-centers injected via EXTRA_DCS env variable.
// Format: JSON array of DC objects, e.g.
//   EXTRA_DCS='[{"key":"AA","flag":"🏢","name":"Zoho Test","accountsUrl":"http://accounts.testzoho.com","consoleUrl":"http://api-console.testzoho.com/"}]'
app.get('/api/config', (req, res) => {
    let extraDCs = [];
    if (process.env.EXTRA_DCS) {
        try {
            extraDCs = JSON.parse(process.env.EXTRA_DCS);
        } catch (e) {
            console.warn('EXTRA_DCS env var is not valid JSON:', e.message);
        }
    }
    res.json({ extraDCs });
});

// Proxy endpoint: Exchange authorization code or refresh token for tokens
app.post('/api/token', async (req, res) => {
    const { accountsUrl, params } = req.body;

    if (!accountsUrl || !params) {
        return res.status(400).json({ error: 'Missing accountsUrl or params' });
    }

    const tokenUrl = `${accountsUrl}/oauth/v2/token`;
    const queryString = new URLSearchParams(params).toString();
    const fullUrl = `${tokenUrl}?${queryString}`;

    try {
        const parsedUrl = new URL(fullUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': 0
            }
        };

        const proxyReq = protocol.request(options, (proxyRes) => {
            let data = '';
            proxyRes.on('data', (chunk) => { data += chunk; });
            proxyRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    res.json(json);
                } catch (e) {
                    res.status(500).json({ error: 'Invalid response from Zoho', raw: data });
                }
            });
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy request error:', err.message);
            res.status(500).json({ error: `Failed to reach Zoho: ${err.message}` });
        });

        proxyReq.end();
    } catch (err) {
        console.error('Token exchange error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// OAuth callback handler — redirects back to the app with the code
app.get('/callback', (req, res) => {
    const code = req.query.code || '';
    const location = req.query.location || '';
    const error = req.query.error || '';
    const accountsServer = req.query['accounts-server'] || '';

    res.redirect(`/?code=${encodeURIComponent(code)}&location=${encodeURIComponent(location)}&error=${encodeURIComponent(error)}&accounts-server=${encodeURIComponent(accountsServer)}`);
});

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🚀 Zoho OAuth Token Generator running at:`);
    console.log(`   http://localhost:${PORT}\n`);
    console.log(`📋 Redirect URL for Zoho API Console:`);
    console.log(`   http://localhost:${PORT}/callback\n`);
});
