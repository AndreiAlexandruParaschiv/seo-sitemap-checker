const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { sitemapUrls } = require('./sitemapconfig');

// Function to check if a URL is from wilson.com
function isWilsonUrl(url) {
  return url.includes('wilson.com');
}

// Common soft 404 indicators in different languages - refined to reduce false positives
const SOFT_404_INDICATORS = {
  strong: [
    '404 not found',
    'page not found',
    'page cannot be found',
    'page does not exist',
    'page no longer exists',
    'content not found',
    'content unavailable',
    'no longer available',
    'no results found',
    'no matching results',
    'error 404',
    'page introuvable', // French
    'seite nicht gefunden', // German
    'pagina non trovata', // Italian
    'página no encontrada', // Spanish
  ],
  // These are weaker indicators that need additional confirmation
  weak: [
    'not found',
    'no results',
    "sorry we couldn't find",
    'we apologize',
    'unavailable',
    'introuvable',
    'nicht gefunden',
  ],
};

// Common words that might appear in legitimate content but could trigger false positives
const FALSE_POSITIVE_TERMS = [
  'demo',
  'ebook',
  'guide',
  'download',
  'resource',
  'webinar',
  'contact',
  'form',
  'signup',
  'sign up',
  'register',
  'login',
  'log in',
  'trial',
  'free trial',
  'pricing',
  'about',
  'features',
  'product',
];

// Function to fetch content from a given URL
async function fetchContent(url) {
  try {
    console.log(`Fetching content from ${url}...`);

    // Configure request headers
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };

    // Add special header for Wilson.com
    if (isWilsonUrl(url)) {
      console.log('Adding special header for Wilson.com request');
      headers['eds_process'] = 'special-wilson-header';
    }

    const response = await axios.get(url, { headers });
    console.log(`Successfully fetched content from ${url}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching content from ${url}: ${error.message}`);
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
async function getSitemapsOrUrls(content) {
  // First try to parse as XML
  const parsedXml = await parseXml(content);

  if (parsedXml) {
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
    }
  }

  // If XML parsing fails or doesn't match expected format, try to parse as plain text
  console.log('Trying to parse as plain text sitemap...');

  // Check if content is a string
  if (typeof content === 'string') {
    // Split by lines and extract URLs
    const lines = content.split('\n');
    const urls = [];

    for (const line of lines) {
      // Extract URL from each line (assuming URL is the first item on each line)
      const parts = line.trim().split(' ');
      if (parts.length > 0 && parts[0].startsWith('http')) {
        urls.push(parts[0]);
      }
    }

    if (urls.length > 0) {
      console.log(`Extracted ${urls.length} URLs from plain text sitemap`);
      return {
        type: 'sitemap',
        urls: urls,
      };
    }
  }

  throw new Error('Could not extract URLs from sitemap: Invalid format');
}

// Function to fetch the HTML content of a page
async function fetchPageContent(url) {
  try {
    console.log(`Fetching content for: ${url}`);

    // Configure request headers
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    };

    // Add special header for Wilson.com
    if (isWilsonUrl(url)) {
      console.log('Adding special header for Wilson.com request');
      headers['eds_process'] = 'special-wilson-header';
    }

    const response = await axios.get(url, {
      headers,
      timeout: 15000, // 15 seconds timeout
    });

    console.log(
      `Successfully fetched content for: ${url} (${response.status})`
    );
    return {
      content: response.data,
      status: response.status,
    };
  } catch (error) {
    if (error.response) {
      console.error(
        `Error fetching page content for ${url}: HTTP ${error.response.status}`
      );
      return {
        content: error.response.data || '',
        status: error.response.status,
      };
    } else {
      console.error(`Error fetching page content for ${url}: ${error.message}`);
      return {
        content: '',
        status: 'Network Error',
      };
    }
  }
}

// Function to check if a URL is likely a legitimate page based on its path
function isLikelyLegitPage(url) {
  const urlObj = new URL(url);
  const path = urlObj.pathname.toLowerCase();

  // Check if the URL path contains terms that suggest it's a legitimate page
  for (const term of FALSE_POSITIVE_TERMS) {
    if (path.includes(term)) {
      return true;
    }
  }

  // Check for common legitimate page patterns
  return path.endsWith('.pdf') ||
      path.endsWith('.html') ||
      path.includes('/blog/') ||
      path.includes('/article/') ||
      path.includes('/product/') ||
      path.includes('/category/');


}

// Function to check if a page is a soft 404
function checkForSoft404(html, url, httpStatus) {
  if (!html) {
    return {
      url,
      isSoft404: false,
      httpStatus,
      indicators: [],
      status: 'Error: No HTML content',
    };
  }

  // Check if the URL is likely a legitimate page based on its path
  const isLegitPage = isLikelyLegitPage(url);

  const $ = cheerio.load(html);
  const pageTitle = $('title').text().toLowerCase();
  const bodyText = $('body').text().toLowerCase();
  const h1Text = $('h1').text().toLowerCase();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const metaDescriptionLower = metaDescription.toLowerCase();

  // Check for HTTP status first
  if (httpStatus !== 200) {
    return {
      url,
      isSoft404: false, // Not a soft 404 if it's a hard 404 or other error
      httpStatus,
      indicators: [],
      status: `Hard error: HTTP ${httpStatus}`,
    };
  }

  // Look for strong soft 404 indicators (these are highly reliable)
  const strongIndicators = [];
  for (const indicator of SOFT_404_INDICATORS.strong) {
    if (
      pageTitle.includes(indicator) ||
      h1Text.includes(indicator) ||
      metaDescriptionLower.includes(indicator)
    ) {
      strongIndicators.push(indicator);
    }
  }

  // If we found strong indicators, it's definitely a soft 404
  if (strongIndicators.length > 0) {
    return {
      url,
      isSoft404: true,
      httpStatus,
      indicators: strongIndicators,
      status: 'Soft 404 detected (strong indicators)',
    };
  }

  // Look for weak soft 404 indicators (need additional confirmation)
  const weakIndicators = [];
  for (const indicator of SOFT_404_INDICATORS.weak) {
    if (
      pageTitle.includes(indicator) ||
      h1Text.includes(indicator) ||
      metaDescriptionLower.includes(indicator)
    ) {
      weakIndicators.push(indicator);
    }
  }

  // Check for empty or minimal content
  const contentLength = bodyText.length;
  const hasMinimalContent = contentLength < 1000; // Increased threshold to reduce false positives

  // Check for search results with no results
  const hasSearchForm =
    $('form input[type="search"]').length > 0 ||
    $('form input[type="text"]').length > 0;
  const hasNoResults =
    bodyText.includes('no results') ||
    bodyText.includes('no matches') ||
    bodyText.includes('nothing found');

  // Check for common soft 404 patterns - more precise image detection
  const has404Image =
    $(
      'img[src*="404" i][alt*="404" i], img[alt*="not found" i][src*="error" i]'
    ).length > 0;

  // Check for interactive elements that suggest a legitimate page
  const hasForm = $('form').length > 0;
  const hasInputFields =
    $('input[type="text"], input[type="email"], textarea').length > 0;
  const hasButtons =
    $('button, input[type="submit"], input[type="button"]').length > 0;

  // Additional indicators
  const additionalIndicators = [];

  if (hasMinimalContent && !hasForm && !hasInputFields) {
    additionalIndicators.push('minimal content without interaction');
  }

  if (hasSearchForm && hasNoResults) {
    additionalIndicators.push('search with no results');
  }

  if (has404Image) {
    additionalIndicators.push('404 image');
  }

  // Combine all weak indicators
  const allWeakIndicators = [...weakIndicators, ...additionalIndicators];

  // Determine if it's a soft 404 based on multiple weak indicators
  // We need at least 2 weak indicators to confirm a soft 404
  // AND we need to make sure it's not a legitimate page based on URL or content
  let isSoft404 = allWeakIndicators.length >= 2;

  // If it's a likely legitimate page based on URL, require stronger evidence
  if (isLegitPage) {
    // For pages that look legitimate based on URL, require at least 3 indicators
    isSoft404 = allWeakIndicators.length >= 3;

    // If the page has forms, input fields, or buttons, it's likely not a soft 404
    if (hasForm || hasInputFields || hasButtons) {
      isSoft404 = false;
    }
  }

  // Special case: if the only indicator is "404 image" but the page has interactive elements,
  // it's probably not a soft 404
  if (
    allWeakIndicators.length === 1 &&
    allWeakIndicators[0] === '404 image' &&
    (hasForm || hasInputFields || hasButtons || isLegitPage)
  ) {
    isSoft404 = false;
  }

  return {
    url,
    isSoft404,
    httpStatus,
    indicators: allWeakIndicators,
    status: isSoft404 ? 'Soft 404 detected (multiple weak indicators)' : 'OK',
  };
}

// Helper function to format the sitemap name from its URL
function getFormattedSitemapName(sitemapUrl) {
  const urlObj = new URL(sitemapUrl);
  let pathname = urlObj.pathname;
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
  const resultsDir = path.join(__dirname, 'resultssoft404');
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

// Function to save results to CSV
function saveResultsToCsv(
  results,
  sitemapUrl,
  okCount,
  soft404Count,
  errorCount,
  totalUrls,
  resultsDir
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const formattedName = getFormattedSitemapName(sitemapUrl);
  const filename = `soft404_results_${formattedName}_${timestamp}.csv`;
  const filePath = path.join(resultsDir, filename);

  const csvContent = results
    .map(
      (result) =>
        `${result.url},${result.httpStatus},${
          result.isSoft404
        },${result.indicators.join('|')},${result.status}`
    )
    .join('\n');

  // Calculate percentages
  const okPercentage = ((okCount / totalUrls) * 100).toFixed(2);
  const soft404Percentage = ((soft404Count / totalUrls) * 100).toFixed(2);
  const errorPercentage = ((errorCount / totalUrls) * 100).toFixed(2);

  // Adding summary at the end of the CSV file
  const summary =
    `\nTotal URLs Checked,${totalUrls}` +
    `\nOK URLs,${okCount} (${okPercentage}%)` +
    `\nSoft 404 URLs,${soft404Count} (${soft404Percentage}%)` +
    `\nError URLs,${errorCount} (${errorPercentage}%)`;

  fs.writeFileSync(
    filePath,
    `URL,HTTP Status,Is Soft 404,Indicators,Status\n${csvContent}${summary}`,
    'utf-8'
  );
  console.log(`Results saved to ${filePath}`);

  return filePath;
}

// Function to process a single sitemap
async function processSitemap(sitemapUrl) {
  console.log(`\n========== Processing sitemap: ${sitemapUrl} ==========\n`);

  const content = await fetchContent(sitemapUrl);
  if (!content) {
    console.error(`Failed to fetch sitemap content from ${sitemapUrl}`);
    return null;
  }

  let sitemapData;
  try {
    sitemapData = await getSitemapsOrUrls(content, sitemapUrl);
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
      okCount: 0,
      soft404Count: 0,
      errorCount: 0,
    };

    for (const childSitemapUrl of sitemapData.urls) {
      const result = await processSitemap(childSitemapUrl);
      if (result) {
        totalResults.totalUrls += result.totalUrls;
        totalResults.okCount += result.okCount;
        totalResults.soft404Count += result.soft404Count;
        totalResults.errorCount += result.errorCount;
      }
    }

    return totalResults;
  }

  const urls = sitemapData.urls;
  console.log(`Processing ${urls.length} URLs from sitemap: ${sitemapUrl}`);

  const results = [];
  let okCount = 0;
  let soft404Count = 0;
  let errorCount = 0;

  // Create the results directory
  const resultsDir = createResultsDirectory(sitemapUrl);

  // Process each URL in the sitemap
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] Checking URL: ${url}`);

    const { content, status } = await fetchPageContent(url);
    const result = checkForSoft404(content, url, status);
    results.push(result);

    // Log the result
    console.log(`  ➤ HTTP Status: ${result.httpStatus}`);
    console.log(`  ➤ Soft 404: ${result.isSoft404}`);
    if (result.indicators.length > 0) {
      console.log(`  ➤ Indicators: ${result.indicators.join(', ')}`);
    }
    console.log(`  ➤ Status: ${result.status}\n`);

    // Update counters
    if (result.isSoft404) {
      soft404Count++;
    } else if (result.httpStatus === 200) {
      okCount++;
    } else {
      errorCount++;
    }
  }

  // Save results to CSV
  const filePath = saveResultsToCsv(
    results,
    sitemapUrl,
    okCount,
    soft404Count,
    errorCount,
    urls.length,
    resultsDir
  );

  // Display summary
  console.log(`\n========== Summary for sitemap: ${sitemapUrl} ==========`);
  console.log(`Total URLs Checked: ${urls.length}`);
  console.log(
    `OK URLs: ${okCount} (${((okCount / urls.length) * 100).toFixed(2)}%)`
  );
  console.log(
    `Soft 404 URLs: ${soft404Count} (${(
      (soft404Count / urls.length) *
      100
    ).toFixed(2)}%)`
  );
  console.log(
    `Error URLs: ${errorCount} (${((errorCount / urls.length) * 100).toFixed(
      2
    )}%)`
  );
  console.log(`Results saved to: ${filePath}\n`);

  return {
    totalUrls: urls.length,
    okCount,
    soft404Count,
    errorCount,
  };
}

// Main function
async function main() {
  console.log('Starting Soft 404 Detection...');
  console.log(`Checking ${sitemapUrls.length} sitemaps`);

  let totalUrls = 0;
  let totalOkCount = 0;
  let totalSoft404Count = 0;
  let totalErrorCount = 0;

  for (const sitemapUrl of sitemapUrls) {
    const result = await processSitemap(sitemapUrl);
    if (result) {
      totalUrls += result.totalUrls;
      totalOkCount += result.okCount;
      totalSoft404Count += result.soft404Count;
      totalErrorCount += result.errorCount;
    }
  }

  // Display overall summary
  console.log('\n========== OVERALL SUMMARY ==========');
  console.log(`Total URLs Checked: ${totalUrls}`);
  if (totalUrls > 0) {
    console.log(
      `OK URLs: ${totalOkCount} (${((totalOkCount / totalUrls) * 100).toFixed(
        2
      )}%)`
    );
    console.log(
      `Soft 404 URLs: ${totalSoft404Count} (${(
        (totalSoft404Count / totalUrls) *
        100
      ).toFixed(2)}%)`
    );
    console.log(
      `Error URLs: ${totalErrorCount} (${(
        (totalErrorCount / totalUrls) *
        100
      ).toFixed(2)}%)`
    );
  } else {
    console.log(
      'No URLs were checked. Please check your sitemap configuration.'
    );
  }
  console.log('Soft 404 Detection completed successfully.');
}

// Run the main function
main();
