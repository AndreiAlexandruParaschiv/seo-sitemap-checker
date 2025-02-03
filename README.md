# seo-sitemap-checker
SEO Sitemap checker 

Checks the sitemap provided in the config file
It handles regular sitemaps (sitemap with URLs) and index sitemaps (sitemap in sitemap)
Return a csv file with each URL's status and count the number of URLs checked.

## How to use
1. Clone the repository
2. Install the dependencies
```bash
npm install
```
3. Run the script for checking the sitemap
```bash
node sitemap.js
```
4. Run the script for checking the sitemap index
```bash
node checkmeta.js
```
5. Check the output file in the output folder

## Config file
The config file is located in the root folder, name `config.js` and `metaconfig.js`
You can change the sitemap URLs in this file .
