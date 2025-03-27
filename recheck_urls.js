const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Function to check if a URL is from wilson.com
function isWilsonUrl(url) {
  return url.includes('wilson.com');
}

// Function to check the status of a URL
async function checkUrlStatus(url) {
  try {
    console.log(`Checking URL: ${url}`);

    // Configure request options
    const requestOptions = {
      maxRedirects: 0, // prevent following redirects
      validateStatus: (status) => status < 400, // accept 3xx to capture redirects
      timeout: 15000, // 15 seconds timeout
    };

    // Add special header for Wilson.com
    if (isWilsonUrl(url)) {
      console.log('Adding special header for Wilson.com request');
      requestOptions.headers = {
        eds_process: 'h9E9Fvp#kvbpq93m',
      };
    }

    const response = await axios.get(url, requestOptions);

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

// Function to create the results directory
function createResultsDirectory() {
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir);
  }
  return resultsDir;
}

// Function to generate a filename for the results
function generateFilename(inputFilename) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = createResultsDirectory();
  const baseName = path.basename(inputFilename, path.extname(inputFilename));

  return path.join(resultsDir, `recheck_${baseName}_${timestamp}.csv`);
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

// Main function to recheck URLs from a CSV file
async function recheckUrls(csvFilePath) {
  if (!fs.existsSync(csvFilePath)) {
    console.error(`Error: File not found: ${csvFilePath}`);
    return;
  }

  console.log(`Reading URLs from: ${csvFilePath}`);

  // Read URLs from the CSV file
  const urls = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        // The first column is expected to be the URL
        if (
          row.URL &&
          !row.URL.includes('Total URLs Checked:') &&
          !row.URL.includes('Successful (200):') &&
          !row.URL.includes('Redirects:') &&
          !row.URL.includes('Errors:') &&
          !row.URL.includes('Not OK Percentage:') &&
          !row.URL.includes('Redundant URLs:')
        ) {
          urls.push(row.URL);
        }
      })
      .on('end', () => {
        console.log(`Found ${urls.length} URLs to check`);
        resolve();
      })
      .on('error', (error) => {
        reject(error);
      });
  }).catch((error) => {
    console.error(`Error reading CSV: ${error.message}`);
    return;
  });

  if (urls.length === 0) {
    console.error('No URLs found in the CSV file');
    return;
  }

  console.log(`Starting to recheck ${urls.length} URLs...`);

  const results = [];
  let successCount = 0;
  let redirectCount = 0;
  let errorCount = 0;
  let redundantCount = 0;

  // Create a map of normalized URLs for easier comparison
  const normalizedUrlMap = new Map();
  urls.forEach((url) => {
    normalizedUrlMap.set(normalizeUrl(url, url), url);
  });

  // Process each URL
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(
      `[${(i + 1).toString().padStart(2, '0')}/${
        urls.length
      }] Checking URL: ${url}`
    );

    const result = await checkUrlStatus(url);
    let redirectInSitemap = 'No';
    let redundantUrl = false;
    let targetUrl = '';

    // Check if the redirect target is in the original list
    if (
      (result.status === 301 || result.status === 302) &&
      result.redirectUrl
    ) {
      redirectCount++;
      const normalizedRedirectUrl = normalizeUrl(result.redirectUrl, url);

      // Check if the redirect target is in the list
      for (const [normalizedUrl, originalUrl] of normalizedUrlMap.entries()) {
        if (normalizedUrl === normalizedRedirectUrl) {
          redirectInSitemap = 'Yes';
          redundantUrl = true;
          targetUrl = originalUrl;
          redundantCount++;
          break;
        }
      }

      console.log(`  ➤ Redirect target in list: ${redirectInSitemap}`);
      if (redundantUrl) {
        console.log(
          `  ➤ REDUNDANT URL: Should be removed (redirects to ${targetUrl})`
        );
      }
    } else if (result.status === 200) {
      successCount++;
    } else {
      errorCount++;
    }

    results.push({
      url: result.url,
      status: result.status,
      redirectUrl: result.redirectUrl || '',
      redirectInList: redirectInSitemap,
      redundantUrl,
      targetUrl,
    });
  }

  // Prepare CSV rows
  const csvContent = results
    .map(
      (result) =>
        `${result.url},${result.status},${result.redirectUrl},${
          result.redirectInList
        },${result.redundantUrl ? 'Yes' : 'No'}`
    )
    .join('\n');

  const totalUrls = results.length;
  const percentOk = ((successCount / totalUrls) * 100).toFixed(2);
  const percentNotOk = (
    ((redirectCount + errorCount) / totalUrls) *
    100
  ).toFixed(2);
  const percentRedundant = ((redundantCount / totalUrls) * 100).toFixed(2);

  const summary = [
    `Total URLs Checked:,${totalUrls}`,
    `Successful (200):,${successCount} (${percentOk}%)`,
    `Redirects:,${redirectCount}`,
    `Errors:,${errorCount}`,
    `Redundant URLs:,${redundantCount} (${percentRedundant}%)`,
    `Not OK Percentage:,${percentNotOk}%`,
  ].join('\n');

  const filename = generateFilename(csvFilePath);

  // Write results to CSV - only include the actual data and one summary section
  fs.writeFileSync(
    filename,
    `URL,Status,Redirect URL,Redirect in List,Redundant URL\n${csvContent}\n${summary}`
  );
  console.log(`Results saved to ${filename}`);

  // Display summary
  console.log(`\n========== Summary ==========`);
  console.log(`Total URLs Checked: ${totalUrls}`);
  console.log(`Successful (200): ${successCount} (${percentOk}%)`);
  console.log(`Redirects: ${redirectCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Redundant URLs: ${redundantCount} (${percentRedundant}%)`);
  console.log(`Not OK Percentage: ${percentNotOk}%`);
  console.log(`Results saved to: ${filename}`);
}

// Check if a file path was provided as a command-line argument
const csvFilePath = process.argv[2];

if (!csvFilePath) {
  console.error('Please provide a path to a CSV file as an argument');
  console.log('Usage: node recheck_urls.js path/to/report.csv');
  process.exit(1);
}

// Run the main function
recheckUrls(csvFilePath);
