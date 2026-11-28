#!/usr/bin/env node
// Show key values of freshly fetched appdata: prints "followers|readers30d|articles"
// Reads data/.appdata.new.json (written by publish_cloud.ps1 before this step).
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'data', '.appdata.new.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const o = d.overview || {};
console.log((o.followers != null ? o.followers : '?') + '|' +
            (o.totalReaders30d != null ? o.totalReaders30d : '?') + '|' +
            (o.totalArticles != null ? o.totalArticles : '?'));
