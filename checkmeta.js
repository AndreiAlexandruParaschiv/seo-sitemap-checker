const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio'); // For parsing HTML
const fs = require('fs');
const path = require('path');
const { sitemapUrls } = require('./metaconfig'); // Import sitemap URLs from config

// Function to fetch XML from a given URL
async function fetchXml(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`Error fetching XML from ${url}: ${error.message}`);
        process.exit(1);
    }
}

// Function to parse the fetched XML
async function parseXml(xml) {
    const parser = new xml2js.Parser();
    try {
        return await parser.parseStringPromise(xml);
    } catch (error) {
        console.error(`Error parsing XML: ${error.message}`);
        process.exit(1);
    }
}

// Extract URLs from the sitemap XML
async function getSitemapUrls(xmlContent) {
    const parsedXml = await parseXml(xmlContent);

    if (parsedXml.urlset && parsedXml.urlset.url) {
        return parsedXml.urlset.url.map((url) => url.loc[0]);
    } else {
        throw new Error('Invalid XML format: No URLs found in the sitemap');
    }
}

// Function to fetch the HTML content of a page
async function fetchPageContent(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`Error fetching page content for ${url}: ${error.message}`);
        return null;
    }
}

// Function to check if the meta tags contain no-index or no-follow
function checkMetaTags(html, url) {
    const $ = cheerio.load(html);
    const metaRobots = $('meta[name="robots"]').attr('content');
    const result = {
        url,
        noIndex: false,
        noFollow: false,
        status: 'OK',
    };

    if (metaRobots) {
        const content = metaRobots.toLowerCase();
        result.noIndex = content.includes('noindex');
        result.noFollow = content.includes('nofollow');
    }

    if (result.noIndex || result.noFollow) {
        result.status = 'Not OK';
    }

    return result;
}

// Function to create the results directory without a timestamp (based on domain)
function createResultsDirectory(sitemapUrl) {
    const resultsDir = path.join(__dirname, 'resultsmeta'); // Base results directory
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
    }

    // Parse the sitemap URL to get the website name
    const parsedUrl = new URL(sitemapUrl);
    const domainName = parsedUrl.hostname.replace(/\./g, '_');

    // Directory for the specific website
    const siteResultsDir = path.join(resultsDir, domainName);

    // Create the directory for the specific website if it doesn't exist
    if (!fs.existsSync(siteResultsDir)) {
        fs.mkdirSync(siteResultsDir);
    }

    return siteResultsDir;
}

// Function to save results and statistics to a CSV file (with timestamp in filename)
function saveResultsToCsv(results, sitemapUrl, okCount, notOkCount, totalUrls, resultsDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `meta_results_${path.basename(sitemapUrl, '.xml')}_${timestamp}.csv`;
    const filePath = path.join(resultsDir, filename);

    const csvContent = results.map((result) =>
        `${result.url},${result.noIndex},${result.noFollow},${result.status}`
    ).join('\n');

    // Adding summary at the end of the CSV file
    const summary = `\nTotal URLs Checked,${totalUrls}\nTotal OK URLs,${okCount}\nTotal Not OK URLs,${notOkCount}`;

    fs.writeFileSync(filePath, `URL,NoIndex,NoFollow,Status\n${csvContent}${summary}`, 'utf-8');
    console.log(`Results saved to ${filePath}`);
}

// Function to process the sitemap, check meta tags, and save results with statistics
async function processSitemap(sitemapUrl) {
    console.log(`Processing sitemap: ${sitemapUrl}`);

    const sitemapXml = await fetchXml(sitemapUrl);
    const urls = await getSitemapUrls(sitemapXml);

    const results = [];
    let okCount = 0;
    let notOkCount = 0;

    // Create the results directory for the current website (without timestamp)
    const resultsDir = createResultsDirectory(sitemapUrl);

    for (const url of urls) {
        const pageContent = await fetchPageContent(url);
        if (pageContent) {
            const result = checkMetaTags(pageContent, url);
            results.push(result);
            if (result.status === 'OK') {
                okCount++;
            } else {
                notOkCount++;
            }
        }
    }

    // Save the results to CSV with statistics
    saveResultsToCsv(results, sitemapUrl, okCount, notOkCount, urls.length, resultsDir);

    // Display statistics
    console.log(`Total URLs Checked: ${urls.length}`);
    console.log(`Total OK URLs: ${okCount}`);
    console.log(`Total Not OK URLs: ${notOkCount}`);
}

// Main function to loop through sitemaps and check each URL
async function main() {
    for (const sitemapUrl of sitemapUrls) {
        await processSitemap(sitemapUrl);
    }

    console.log('All sitemaps processed successfully.');
}

main();
