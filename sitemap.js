const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const { sitemapUrls } = require('./config'); // import multiple sitemaps
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
            maxRedirects: 0, // prevent following redirects
            validateStatus: (status) => status < 400 // accept 3xx to capture redirects
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

// Helper function to format the sitemap name from its URL
function getFormattedSitemapName(sitemapUrl) {
    const urlObj = new URL(sitemapUrl);
    let pathname = urlObj.pathname; // e.g., '/resources/hr-glossary/sitemap.xml'
    // Remove the leading slash if present
    if (pathname.startsWith('/')) {
        pathname = pathname.substring(1);
    }
    // Remove the '.xml' extension if present
    if (pathname.endsWith('.xml')) {
        pathname = pathname.slice(0, -4);
    }
    // Replace any remaining '/' with '-' to create a filename-friendly string
    return pathname.replace(/\//g, '-');
}

function generateFilename(baseUrl, sitemapName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const parsedUrl = new URL(baseUrl);
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

    return path.join(dirPath, `${sitemapName}_${timestamp}.csv`);
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
        // Only status 200 is considered "ok"
        if (result.status === 200) {
            successCount++;
        } else if (result.status === 301 || result.status === 302) {
            // Redirects are treated as "not ok"
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

    // Prepare CSV rows
    const csvContent = results
        .map((result) => `${result.url},${result.status},${result.redirectUrl}`)
        .join('\n');

    const totalUrls = results.length;
    // Calculate percentages where only status code 200 counts as ok
    const percentOk = ((successCount / totalUrls) * 100).toFixed(2);
    const percentNotOk = (((redirectCount + errorCount) / totalUrls) * 100).toFixed(2);

    // Build the summary with counts and percentages
    const summary = [
        `Total URLs Checked:,${totalUrls}`,
        `Successful (200):,${successCount} (${percentOk}%)`,
        `Redirects (as Not OK):,${redirectCount}`,
        `Errors:,${errorCount}`,
        `Not OK Percentage:,${percentNotOk}%`
    ].join('\n');

    // Use the formatted sitemap name for the filename
    const sitemapName = getFormattedSitemapName(sitemapUrl);
    const filename = generateFilename(sitemapUrl, sitemapName);

    fs.writeFileSync(filename, `URL,Status,Redirect URL\n${csvContent}\n${summary}`);
    console.log(`Results saved to ${filename}`);

    return { totalUrls, successCount, redirectCount, errorCount };
}

async function main() {
    let totalUrls = 0;
    let successCount = 0;
    let redirectCount = 0;
    let errorCount = 0;

    // Process each sitemap from the config
    for (const sitemapUrl of sitemapUrls) {
        console.log(`Processing sitemap: ${sitemapUrl}`);
        const result = await processSitemap(sitemapUrl);
        totalUrls += result.totalUrls;
        successCount += result.successCount;
        redirectCount += result.redirectCount;
        errorCount += result.errorCount;
    }

    // Calculate overall percentages
    const overallPercentOk = ((successCount / totalUrls) * 100).toFixed(2);
    const overallPercentNonOk = (((redirectCount + errorCount) / totalUrls) * 100).toFixed(2);

    console.log(`\nSummary: Verified ${totalUrls} URLs, ${successCount} returned 200, ${redirectCount} were redirects, and ${errorCount} had errors.`);
    console.log(`Overall: OK ${overallPercentOk}%, Non-OK ${overallPercentNonOk}%`);
}

main();
