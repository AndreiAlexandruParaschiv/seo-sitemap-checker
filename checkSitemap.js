const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const { sitemapUrl } = require('./config'); // sitemap URL is in config.js

async function fetchXml(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`Error fetching XML from ${url}: ${error.message}`);
        process.exit(1);
    }
}

async function parseXml(xml) {
    const parser = new xml2js.Parser();
    try {
        const result = await parser.parseStringPromise(xml);
        return result;
    } catch (error) {
        console.error(`Error parsing XML: ${error.message}`);
        process.exit(1);
    }
}

async function getSitemapsOrUrls(xmlContent) {
    const parsedXml = await parseXml(xmlContent);

    if (parsedXml.sitemapindex && parsedXml.sitemapindex.sitemap) {
        // sitemap index
        return {
            type: 'index',
            urls: parsedXml.sitemapindex.sitemap.map((sitemap) => sitemap.loc[0])
        };
    } else if (parsedXml.urlset && parsedXml.urlset.url) {
        // regular sitemap
        return {
            type: 'sitemap',
            urls: parsedXml.urlset.url.map((url) => url.loc[0])
        };
    } else {
        throw new Error('Invalid XML format: Neither sitemap index nor sitemap detected');
    }
}

async function checkUrlStatus(url) {
    try {
        const response = await axios.get(url);
        return { url, status: response.status };
    } catch (error) {
        return { url, status: error.response ? error.response.status : 'Network Error' };
    }
}

async function main() {
    const xmlContent = await fetchXml(sitemapUrl);
    const { type, urls } = await getSitemapsOrUrls(xmlContent);

    const results = [];

    if (type === 'index') {
        for (const sitemapUrl of urls) {
            console.log(`Processing sitemap: ${sitemapUrl}`);
            const sitemapXml = await fetchXml(sitemapUrl);
            const sitemapUrls = (await getSitemapsOrUrls(sitemapXml)).urls;

            for (const url of sitemapUrls) {
                const { url: checkedUrl, status } = await checkUrlStatus(url);
                const inSitemap = status === 200 ? 'YES' : 'NO';
                results.push({ url: checkedUrl, status, inSitemap });
                console.log(`Checked ${checkedUrl}: ${status}`);
            }
        }
    } else if (type === 'sitemap') {
        for (const url of urls) {
            const { url: checkedUrl, status } = await checkUrlStatus(url);
            const inSitemap = status === 200 ? 'YES' : 'NO';
            results.push({ url: checkedUrl, status, inSitemap });
            console.log(`Checked ${checkedUrl}: ${status}`);
        }
    }

    const totalUrls = results.length;
    const csvContent = results
        .map((result) => `${result.url},${result.status},${result.inSitemap}`)
        .join('\n');
    const summary = `Total URLs Checked:,${totalUrls}`;

    fs.writeFileSync('sitemap_status.csv', `URL,Status,inSitemap\n${csvContent}\n${summary}`);
    console.log('Results saved to sitemap_status.csv');
}

main();
