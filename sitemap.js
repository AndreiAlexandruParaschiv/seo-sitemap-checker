const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const { sitemapUrls } = require('./config'); // import multiple sitemap
const path = require('path');

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
        return await parser.parseStringPromise(xml);
    } catch (error) {
        console.error(`Error parsing XML: ${error.message}`);
        process.exit(1);
    }
}

async function getSitemapsOrUrls(xmlContent) {
    const parsedXml = await parseXml(xmlContent);

    if (parsedXml.sitemapindex && parsedXml.sitemapindex.sitemap) {
        return {
            type: 'index',
            urls: parsedXml.sitemapindex.sitemap.map((sitemap) => sitemap.loc[0])
        };
    } else if (parsedXml.urlset && parsedXml.urlset.url) {
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
        const response = await axios.get(url, {
            maxRedirects: 0, // Prevent following redirects
            validateStatus: (status) => status < 400 // Accept 3xx status codes as valid
        });

        // Handle 3xx redirects
        if (response.status === 301 || response.status === 302) {
            console.log(`Redirect detected: ${url} -> ${response.headers.location}`);
            return {
                url,
                status: response.status,
                redirectUrl: response.headers.location
            };
        }
        console.log(`Success: ${url} -> ${response.status}`);
        return { url, status: response.status };
    } catch (error) {
        // Catch network errors or other types of issues
        return { url, status: error.response ? error.response.status : 'Network Error' };
    }
}

function generateFilename(baseName, directory) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const parsedUrl = new URL(baseName);
    const domainName = parsedUrl.hostname.replace(/\./g, '_');
    const resultsDir = path.join(__dirname, 'results');
    const dirPath = path.join(resultsDir, domainName);

    // Create results directory if it doesn't exist
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
    }

    // Create domain-specific directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }

    return path.join(dirPath, `${directory}_${timestamp}.csv`);
}

async function processSitemap(sitemapUrl) {
    const sitemapXml = await fetchXml(sitemapUrl);
    const sitemapUrls = (await getSitemapsOrUrls(sitemapXml)).urls;

    const results = [];
    let successCount = 0;
    let redirectCount = 0;
    let errorCount = 0;

    for (const url of sitemapUrls) {
        const result = await checkUrlStatus(url);
        if (result.status === 200) {
            successCount++;
        } else if (result.status === 301 || result.status === 302) {
            redirectCount++;
            console.log(`Redirect detected: ${result.url} -> ${result.redirectUrl}`);
        } else {
            errorCount++;
        }

        // Include the original and redirect URL if applicable
        results.push({
            url: result.url,
            status: result.status,
            redirectUrl: result.redirectUrl || ''
        });
    }

    const csvContent = results
        .map((result) => `${result.url},${result.status},${result.redirectUrl}`)
        .join('\n');
    const totalUrls = results.length;
    const summary = `Total URLs Checked:,${totalUrls}\nSuccessful:,${successCount}\nRedirects:,${redirectCount}\nErrors:,${errorCount}`;
    const filename = generateFilename(sitemapUrl, path.basename(sitemapUrl, '.xml'));

    fs.writeFileSync(filename, `URL,Status,Redirect URL\n${csvContent}\n${summary}`);
    console.log(`Results saved to ${filename}`);

    return { totalUrls, successCount, redirectCount, errorCount };
}

async function main() {
    let totalUrls = 0;
    let successCount = 0;
    let redirectCount = 0;
    let errorCount = 0;

    // Loop through all sitemaps in the config file
    for (const sitemapUrl of sitemapUrls) {
        console.log(`Processing sitemap: ${sitemapUrl}`);
        const result = await processSitemap(sitemapUrl);
        totalUrls += result.totalUrls;
        successCount += result.successCount;
        redirectCount += result.redirectCount;
        errorCount += result.errorCount;
    }

    console.log(`Summary: Verified ${totalUrls} URLs, ${successCount} have 200 status code, ${redirectCount} are redirects, ${errorCount} have errors.`);
}

main();
