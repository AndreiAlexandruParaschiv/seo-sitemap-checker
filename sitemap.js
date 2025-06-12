const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const { sitemapUrls, sitemaps } = require('./sitemapconfig'); // import multiple sitemaps
const path = require('path');

const CONCURRENCY_LIMIT = 10; // Number of concurrent HTTP requests

/**
 * Find the closest matching URL for a 404 error
 * @param {string} notFoundUrl - The URL that returned 404
 * @param {Array<string>} validUrls - List of valid URLs from the sitemap
 * @returns {string} - The closest matching URL or empty string if none found
 */
function findSimilarUrl(notFoundUrl, validUrls) {
  if (!validUrls || validUrls.length === 0) return '';

  try {
    // Parse the not found URL
    const parsedUrl = new URL(notFoundUrl);
    const urlPath = parsedUrl.pathname;

    // Strategy 1: Try parent paths
    const pathParts = urlPath.split('/').filter((part) => part);
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = '/' + pathParts.slice(0, i).join('/');
      const parentUrl = `${parsedUrl.origin}${parentPath}`;

      // Check if this parent URL exists in our valid URLs
      if (validUrls.includes(parentUrl)) {
        return parentUrl;
      }
    }

    // Strategy 2: Look for similar URLs with path pattern matching
    // Extract potential keywords from the path
    const keywords = pathParts.flatMap((part) => part.split('-'));
    const relevantUrls = validUrls.filter((url) => {
      // Only consider URLs from the same domain
      return url.startsWith(parsedUrl.origin);
    });

    // Find URLs that contain similar path segments
    const similarUrls = relevantUrls.filter((url) => {
      try {
        const urlPathParts = new URL(url).pathname
          .split('/')
          .filter((part) => part);
        const pathKeywords = urlPathParts.flatMap((part) => part.split('-'));

        // Check for keyword overlap
        return keywords.some(
          (keyword) =>
            keyword.length > 3 && // Only consider meaningful keywords
            pathKeywords.some(
              (pathKeyword) =>
                pathKeyword.includes(keyword) || keyword.includes(pathKeyword)
            )
        );
      } catch (e) {
        return false;
      }
    });

    // Return the most similar URL if found
    if (similarUrls.length > 0) {
      return similarUrls[0]; // Return the first match
    }

    // Strategy 3: Default to the site homepage if nothing else matches
    return parsedUrl.origin;
  } catch (error) {
    console.error(
      `Error finding similar URL for ${notFoundUrl}: ${error.message}`
    );
    return '';
  }
}

// Function to check if a URL is from wilson.com
function isWilsonUrl(url) {
  return url.includes('wilson.com');
}

// Function to fetch XML from a given URL
async function fetchXml(url) {
  try {
    console.log(`Fetching XML from ${url}...`);

    // Configure request options
    const requestOptions = {
      headers: {
        //'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'User-Agent': 'AhrefsBot',
      },
    };

    // Add special header for Wilson.com
    if (isWilsonUrl(url)) {
      console.log('Adding special header for Wilson.com request');
      requestOptions.headers['eds_process'] = 'special-wilson-header';
    }

    const response = await axios.get(url, requestOptions);
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
    // Configure request options
    const requestOptions = {
      headers: {
        //'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'User-Agent': 'AhrefsBot', // Use AhrefsBot to avoid blocking
      },
      maxRedirects: 0, // prevent following redirects
      validateStatus: (status) => status < 400, // accept 3xx to capture redirects
      timeout: 15000, // 15 seconds timeout
    };

    // Add special header for Wilson.com
    if (isWilsonUrl(url)) {
      requestOptions.headers['eds_process'] = 'special-header-for-wilson';
    }

    const response = await axios.get(url, requestOptions);

    // Handle 3xx redirects
    if (response.status === 301 || response.status === 302) {
      return {
        url,
        status: response.status,
        redirectUrl: response.headers.location,
      };
    }

    return { url, status: response.status };
  } catch (error) {
    // Catch network errors or other types of issues
    const errorStatus = error.response
      ? error.response.status
      : 'Network Error';
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
function generateFilename(sitemapUrl, fileType = 'results') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sitemapName = getFormattedSitemapName(sitemapUrl);
  const resultsDir = createResultsDirectory(sitemapUrl);

  return path.join(
    resultsDir,
    `sitemap_${fileType}_${sitemapName}_${timestamp}.csv`
  );
}

// Function to normalize a URL for comparison
function normalizeUrl(url, baseUrl) {
  try {
    const fullUrl = new URL(url, baseUrl);
    // Remove trailing slash for consistent comparison
    let normalizedPath = fullUrl.pathname;
    if (normalizedPath.endsWith('/') && normalizedPath.length > 1) {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    return `${fullUrl.origin}${normalizedPath}`;
  } catch (error) {
    console.error(`Error normalizing URL ${url}: ${error.message}`);
    return url;
  }
}

/**
 * Utility to run async tasks with concurrency limit
 */
async function runWithConcurrency(tasks, limit, onProgress) {
  let index = 0;
  let completed = 0;
  const results = new Array(tasks.length);
  const total = tasks.length;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      try {
        results[current] = await tasks[current]();
      } catch (e) {
        results[current] = undefined;
      }
      completed++;
      // Print progress every 100 URLs, and always for the first and last
      if (onProgress && (completed === 1 || completed % 100 === 0 || completed === total)) {
        onProgress(completed, total);
      }
    }
  }

  const workers = Array(Math.min(limit, tasks.length)).fill(0).map(worker);
  await Promise.all(workers);
  return results;
}

/**
 * Detect duplicate URLs and write to CSV if any found
 */
function detectAndWriteDuplicates(urls, sitemapUrl) {
  const urlCount = {};
  for (const url of urls) {
    urlCount[url] = (urlCount[url] || 0) + 1;
  }
  const duplicates = Object.entries(urlCount).filter(([_, count]) => count > 1);
  if (duplicates.length === 0) return;

  const resultsDir = createResultsDirectory(sitemapUrl);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sitemapName = getFormattedSitemapName(sitemapUrl);
  const filename = path.join(resultsDir, `sitemap_duplicates_${sitemapName}_${timestamp}.csv`);
  const csv = ['Duplicated URL,Count', ...duplicates.map(([url, count]) => `${url},${count}`)].join('\n');
  fs.writeFileSync(filename, csv);
  console.log(`Found ${duplicates.length} duplicated URLs. Duplicates saved to ${filename}`);
}

// Function to process a single sitemap
async function processSitemap(sitemapUrl) {
  console.log(`\n========== Processing sitemap: ${sitemapUrl} ==========\n`);

  const startTime = Date.now();

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
    let totalResults = {
      totalUrls: 0,
      successCount: 0,
      redirectCount: 0,
      errorCount: 0,
      redundantCount: 0,
      elapsedSeconds: 0,
    };
    for (const childSitemapUrl of sitemapData.urls) {
      const result = await processSitemap(childSitemapUrl);
      if (result) {
        totalResults.totalUrls += result.totalUrls;
        totalResults.successCount += result.successCount;
        totalResults.redirectCount += result.redirectCount;
        totalResults.errorCount += result.errorCount;
        totalResults.redundantCount += result.redundantCount || 0;
        totalResults.elapsedSeconds += result.elapsedSeconds || 0;
      }
    }
    return totalResults;
  }

  const urls = Array.from(new Set(sitemapData.urls));
  // Detect and write duplicates (using original list, not deduped)
  detectAndWriteDuplicates(sitemapData.urls, sitemapUrl);

  console.log(`Total URLs to check: ${urls.length}`);

  const results = [];
  let successCount = 0;
  let redirectCount = 0;
  let errorCount = 0;
  let redundantCount = 0;
  const validUrls = [];
  const normalizedUrlMap = new Map();
  urls.forEach((url) => {
    normalizedUrlMap.set(normalizeUrl(url, sitemapUrl), url);
  });

  // Prepare all check tasks
  const tasks = urls.map((url) => async () => {
    const result = await checkUrlStatus(url);
    return { url, ...result };
  });

  // Run with concurrency and progress
  let lastPercent = 0;
  const allResults = await runWithConcurrency(tasks, CONCURRENCY_LIMIT, (done, total) => {
    const percent = Math.floor((done / total) * 100);
    if (percent !== lastPercent && percent % 5 === 0) {
      console.log(`Progress: ${done}/${total} URLs checked (${percent}%)`);
      lastPercent = percent;
    }
  });

  // Process results
  for (let i = 0; i < allResults.length; i++) {
    const { url, status, redirectUrl } = allResults[i];
    let redirectInSitemapRedundant = 'No';
    let targetUrl = '';
    let urlSuggested = '';
    if (status === 200) {
      validUrls.push(url);
      successCount++;
    } else if ((status === 301 || status === 302) && redirectUrl) {
      redirectCount++;
      urlSuggested = redirectUrl;
      const normalizedRedirectUrl = normalizeUrl(redirectUrl, url);
      for (const [normalizedUrl, originalUrl] of normalizedUrlMap.entries()) {
        if (normalizedUrl === normalizedRedirectUrl) {
          redirectInSitemapRedundant = 'Yes';
          targetUrl = originalUrl;
          redundantCount++;
          break;
        }
      }
    } else if (status === 404) {
      errorCount++;
      if (validUrls.length > 0) {
        urlSuggested = findSimilarUrl(url, validUrls);
      }
    } else {
      errorCount++;
    }
    results.push({
      url,
      status,
      redirectUrl: redirectUrl || '',
      urlSuggested,
      redirectInSitemapRedundant,
      targetUrl,
    });
  }

  // Second pass for 404s without suggestions
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 404 && !result.urlSuggested && validUrls.length > 0) {
      result.urlSuggested = findSimilarUrl(result.url, validUrls);
    }
  }

  // Prepare CSV rows
  const csvContent = results
    .map(
      (result) =>
        `${result.url},${result.status},${result.redirectUrl},${result.urlSuggested},${result.redirectInSitemapRedundant}`
    )
    .join('\n');

  const totalUrls = results.length;
  const percentOk = ((successCount / totalUrls) * 100).toFixed(2);
  const percentNotOk = (((redirectCount + errorCount) / totalUrls) * 100).toFixed(2);
  const percentRedundant = ((redundantCount / totalUrls) * 100).toFixed(2);
  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

  const summary = [
    `Total URLs Checked:,${totalUrls}`,
    `Successful (200):,${successCount} (${percentOk}%)`,
    `Redirects:,${redirectCount}`,
    `Errors:,${errorCount}`,
    `Redundant URLs:,${redundantCount} (${percentRedundant}%)`,
    `Not OK Percentage:,${percentNotOk}%`,
    `Elapsed Time (seconds):,${elapsedSeconds}`,
  ].join('\n');

  const filename = generateFilename(sitemapUrl);
  fs.writeFileSync(
    filename,
    `URL,Status,Redirect URL,URL Suggested,Redirect in Sitemap(redundant)\n${csvContent}\n${summary}`
  );
  console.log(`Results saved to ${filename}`);

  // Display summary
  console.log(`\n========== Summary for sitemap: ${sitemapUrl} ==========`);
  console.log(`Total URLs Checked: ${totalUrls}`);
  console.log(`Successful (200): ${successCount} (${percentOk}%)`);
  console.log(`Redirects: ${redirectCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Redundant URLs: ${redundantCount} (${percentRedundant}%)`);
  console.log(`Not OK Percentage: ${percentNotOk}%`);
  console.log(`Elapsed Time (seconds): ${elapsedSeconds}`);
  console.log();

  return {
    totalUrls,
    successCount,
    redirectCount,
    errorCount,
    redundantCount,
    elapsedSeconds: parseFloat(elapsedSeconds),
  };
}

// Main function
async function main() {
  console.log('Starting Sitemap URL Verification...');
  console.log(`Checking ${sitemapUrls.length} sitemaps`);

  const overallStart = Date.now();

  let totalUrls = 0;
  let totalSuccessCount = 0;
  let totalRedirectCount = 0;
  let totalErrorCount = 0;
  let totalRedundantCount = 0;
  let totalElapsedSeconds = 0;

  for (const sitemapUrl of sitemapUrls) {
    const result = await processSitemap(sitemapUrl);
    if (result) {
      totalUrls += result.totalUrls;
      totalSuccessCount += result.successCount;
      totalRedirectCount += result.redirectCount;
      totalErrorCount += result.errorCount;
      totalRedundantCount += result.redundantCount || 0;
      totalElapsedSeconds += result.elapsedSeconds || 0;
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
    const overallPercentRedundant = (
      (totalRedundantCount / totalUrls) *
      100
    ).toFixed(2);

    console.log(
      `Successful (200): ${totalSuccessCount} (${overallPercentOk}%)`
    );
    console.log(`Redirects: ${totalRedirectCount}`);
    console.log(`Errors: ${totalErrorCount}`);
    console.log(
      `Redundant URLs: ${totalRedundantCount} (${overallPercentRedundant}%)`
    );
    console.log(`Not OK Percentage: ${overallPercentNotOk}%`);
    const overallElapsed = ((Date.now() - overallStart) / 1000).toFixed(2);
    console.log(`Elapsed Time (seconds): ${overallElapsed}`);
  } else {
    console.log(
      'No URLs were checked. Please check your sitemap configuration.'
    );
  }
  console.log('Sitemap URL Verification completed successfully.');
}

// Run the main function
main();
