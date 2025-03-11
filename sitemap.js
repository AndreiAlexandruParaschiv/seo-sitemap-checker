const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const { sitemapUrls } = require('./sitemapconfig'); // import multiple sitemaps
const path = require('path');

// Function to fetch XML from a given URL
async function fetchXml(url) {
  try {
    console.log(`Fetching XML from ${url}...`);
    const response = await axios.get(url);
    console.log(`Successfully fetched XML from ${url}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching XML from ${url}: ${error.message}`);
    return null;
  }
}

// Function to parse the fetched XML
async function parseXml(xml) {
  const parser = new xml2js.Parser();
  try {
    console.log('Parsing XML...');
    return await parser.parseStringPromise(xml);
  } catch (error) {
    console.error(`Error parsing XML: ${error.message}`);
    return null;
  }
}

// Function to extract URLs from sitemap or sitemap index
async function getSitemapsOrUrls(xmlContent) {
  const parsedXml = await parseXml(xmlContent);

  if (!parsedXml) {
    throw new Error('Failed to parse XML content');
  }

  if (parsedXml.sitemapindex && parsedXml.sitemapindex.sitemap) {
    console.log('Detected sitemap index with multiple sitemaps');
    return {
      type: 'index',
      urls: parsedXml.sitemapindex.sitemap.map((sitemap) => sitemap.loc[0]),
    };
  } else if (parsedXml.urlset && parsedXml.urlset.url) {
    console.log(`Detected sitemap with ${parsedXml.urlset.url.length} URLs`);
    return {
      type: 'sitemap',
      urls: parsedXml.urlset.url.map((url) => url.loc[0]),
    };
  } else {
    throw new Error(
      'Invalid XML format: Neither sitemap index nor sitemap detected'
    );
  }
}

// Function to check the status of a URL
async function checkUrlStatus(url) {
  try {
    console.log(`Checking URL: ${url}`);
    const response = await axios.get(url, {
      maxRedirects: 0, // prevent following redirects
      validateStatus: (status) => status < 400, // accept 3xx to capture redirects
      timeout: 15000, // 15 seconds timeout
    });

    // Handle 3xx redirects
    if (response.status === 301 || response.status === 302) {
      console.log(
        `  ➤ Redirect (${response.status}): ${url} → ${response.headers.location}`
      );
      return {
        url,
        status: response.status,
        redirectUrl: response.headers.location,
      };
    }

    console.log(`  ➤ Success (${response.status}): ${url}`);
    return { url, status: response.status };
  } catch (error) {
    // Catch network errors or other types of issues
    const errorStatus = error.response
      ? error.response.status
      : 'Network Error';
    console.log(`  ➤ Error (${errorStatus}): ${url}`);
    return { url, status: errorStatus };
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
  return pathname.replace(/\//g, '-') || 'sitemap';
}

// Function to create the results directory
function createResultsDirectory(sitemapUrl) {
  const resultsDir = path.join(__dirname, 'results');
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

// Function to generate a filename for the results
function generateFilename(sitemapUrl) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sitemapName = getFormattedSitemapName(sitemapUrl);
  const resultsDir = createResultsDirectory(sitemapUrl);

  return path.join(
    resultsDir,
    `sitemap_results_${sitemapName}_${timestamp}.csv`
  );
}

// Function to process a single sitemap
async function processSitemap(sitemapUrl) {
  console.log(`\n========== Processing sitemap: ${sitemapUrl} ==========\n`);

  const sitemapXml = await fetchXml(sitemapUrl);
  if (!sitemapXml) {
    console.error(`Failed to fetch sitemap content from ${sitemapUrl}`);
    return null;
  }

  let sitemapData;
  try {
    sitemapData = await getSitemapsOrUrls(sitemapXml);
  } catch (error) {
    console.error(`Error processing sitemap ${sitemapUrl}: ${error.message}`);
    return null;
  }

  // If it's a sitemap index, process each child sitemap
  if (sitemapData.type === 'index') {
    console.log(
      `Found sitemap index with ${sitemapData.urls.length} child sitemaps`
    );
    let totalResults = {
      totalUrls: 0,
      successCount: 0,
      redirectCount: 0,
      errorCount: 0,
    };

    for (const childSitemapUrl of sitemapData.urls) {
      const result = await processSitemap(childSitemapUrl);
      if (result) {
        totalResults.totalUrls += result.totalUrls;
        totalResults.successCount += result.successCount;
        totalResults.redirectCount += result.redirectCount;
        totalResults.errorCount += result.errorCount;
      }
    }

    return totalResults;
  }

  const urls = Array.from(new Set(sitemapData.urls));
  console.log(`Processing ${urls.length} URLs from sitemap: ${sitemapUrl}`);

  const results = [];
  let successCount = 0;
  let redirectCount = 0;
  let errorCount = 0;

  // Process each URL in the sitemap
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] Checking URL: ${url}`);

    const result = await checkUrlStatus(url);
    let redirectInSitemap = 'No';

    // Check if the redirect target is in the sitemap
    if (
      (result.status === 301 || result.status === 302) &&
      result.redirectUrl
    ) {
      redirectCount++;

      // Normalize URLs before comparison
      const normalizedRedirectUrl = new URL(result.redirectUrl, sitemapUrl)
        .pathname;

      const isRedirectInSitemap = urls.some((sitemapEntry) => {
        return (
          new URL(sitemapEntry, sitemapUrl).pathname === normalizedRedirectUrl
        );
      });

      if (isRedirectInSitemap) {
        redirectInSitemap = 'Yes';
      }

      console.log(`  ➤ Redirect target in sitemap: ${redirectInSitemap}`);
    } else if (result.status === 200) {
      successCount++;
    } else {
      errorCount++;
    }

    results.push({
      url: result.url,
      status: result.status,
      redirectUrl: result.redirectUrl || '',
      redirectInSitemap,
    });
  }

  // Prepare CSV rows
  const csvContent = results
    .map(
      (result) =>
        `${result.url},${result.status},${result.redirectUrl},${result.redirectInSitemap}`
    )
    .join('\n');

  const totalUrls = results.length;
  const percentOk = ((successCount / totalUrls) * 100).toFixed(2);
  const percentNotOk = (
    ((redirectCount + errorCount) / totalUrls) *
    100
  ).toFixed(2);

  const summary = [
    `Total URLs Checked:,${totalUrls}`,
    `Successful (200):,${successCount} (${percentOk}%)`,
    `Redirects:,${redirectCount}`,
    `Errors:,${errorCount}`,
    `Not OK Percentage:,${percentNotOk}%`,
  ].join('\n');

  const filename = generateFilename(sitemapUrl);

  // Include the new column in CSV
  fs.writeFileSync(
    filename,
    `URL,Status,Redirect URL,Redirect in Sitemap\n${csvContent}\n${summary}`
  );
  console.log(`Results saved to ${filename}`);

  // Display summary
  console.log(`\n========== Summary for sitemap: ${sitemapUrl} ==========`);
  console.log(`Total URLs Checked: ${totalUrls}`);
  console.log(`Successful (200): ${successCount} (${percentOk}%)`);
  console.log(`Redirects: ${redirectCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Not OK Percentage: ${percentNotOk}%`);
  console.log(`Results saved to: ${filename}\n`);

  return { totalUrls, successCount, redirectCount, errorCount };
}

// Main function
async function main() {
  console.log('Starting Sitemap URL Verification...');
  console.log(`Checking ${sitemapUrls.length} sitemaps`);

  let totalUrls = 0;
  let totalSuccessCount = 0;
  let totalRedirectCount = 0;
  let totalErrorCount = 0;

  for (const sitemapUrl of sitemapUrls) {
    const result = await processSitemap(sitemapUrl);
    if (result) {
      totalUrls += result.totalUrls;
      totalSuccessCount += result.successCount;
      totalRedirectCount += result.redirectCount;
      totalErrorCount += result.errorCount;
    }
  }

  // Display overall summary
  console.log('\n========== OVERALL SUMMARY ==========');
  console.log(`Total URLs Checked: ${totalUrls}`);
  if (totalUrls > 0) {
    const overallPercentOk = ((totalSuccessCount / totalUrls) * 100).toFixed(2);
    const overallPercentNotOk = (
      ((totalRedirectCount + totalErrorCount) / totalUrls) *
      100
    ).toFixed(2);

    console.log(
      `Successful (200): ${totalSuccessCount} (${overallPercentOk}%)`
    );
    console.log(`Redirects: ${totalRedirectCount}`);
    console.log(`Errors: ${totalErrorCount}`);
    console.log(`Not OK Percentage: ${overallPercentNotOk}%`);
  } else {
    console.log(
      'No URLs were checked. Please check your sitemap configuration.'
    );
  }
  console.log('Sitemap URL Verification completed successfully.');
}

// Run the main function
main();
