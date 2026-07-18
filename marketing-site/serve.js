const express = require('express');
const path = require('path');

const app = express();

// Clean-path routes, matching how src/server.ts will serve these pages once merged in.
const pages = {
  '/': 'index.html',
  '/about': 'about.html',
  '/services': 'services.html',
  '/resources': 'resources.html',
  '/contact': 'contact.html',
  '/privacy': 'privacy.html',
  '/sms-terms': 'sms-terms.html',
};
app.get(Object.keys(pages), (req, res) => {
  res.sendFile(path.join(__dirname, pages[req.path]));
});

app.use(express.static(__dirname));

const port = 4321;
app.listen(port, () => console.log(`marketing-site preview on http://localhost:${port}`));
