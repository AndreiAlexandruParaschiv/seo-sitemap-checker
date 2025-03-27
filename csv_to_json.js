const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { sitemapUrls, sitemaps } = require('./sitemapconfig'); // Import sitemap URLs from config

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

/**
 * Determines if a row from the CSV is a data row (not a summary row)
 * @param {Object} row - CSV row data
 * @returns {boolean} - True if row contains data and not a summary
 */
function isDataRow(row) {
  return (
    row.URL &&
    !row.URL.includes('Total URLs Checked:') &&
    !row.URL.includes('Successful (200):') &&
    !row.URL.includes('Redirects:') &&
    !row.URL.includes('Errors:') &&
    !row.URL.includes('Not OK Percentage:') &&
    !row.URL.includes('Redundant URLs:')
  );
}

/**
 * Extracts configuration data from sitemapconfig.js
 * @param {number} sitemapIndex - Index of sitemap in config
 * @returns {Object} - Sitemap URL and site ID
 */
function getSitemapConfig(sitemapIndex) {
  // Default values
  let sitemapUrl = 'unknown';
  let siteId = null;

  try {
    // First check if we have the new sitemaps array structure
    if (sitemaps && sitemaps.length > sitemapIndex) {
      sitemapUrl = sitemaps[sitemapIndex].url;
      siteId = sitemaps[sitemapIndex].siteId;
      console.log(`Using sitemap URL from config: ${sitemapUrl}`);
      if (siteId) {
        console.log(`Using site ID from config: ${siteId}`);
      }
    }
    // Fallback to the old format if needed
    else if (sitemapUrls && sitemapUrls.length > sitemapIndex) {
      sitemapUrl = sitemapUrls[sitemapIndex];
      console.log(
        `Using sitemap URL from config (legacy format): ${sitemapUrl}`
      );
    } else {
      console.warn('No sitemap URL found in config, using "unknown"');
    }
  } catch (error) {
    console.error(`Error getting sitemap config: ${error.message}`);
  }

  return { sitemapUrl, siteId };
}

/**
 * Parses the CSV file and extracts data
 * @param {string} csvFilePath - Path to the CSV file
 * @returns {Promise<Object>} - Parsed data including valid URLs and issues
 */
async function parseCSVData(csvFilePath) {
  return new Promise((resolve, reject) => {
    const validUrls = [];
    const allUrls = [];
    const issues = [];

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        if (isDataRow(row)) {
          allUrls.push(row);

          // Track valid URLs for suggesting alternatives to 404s
          if (row.Status === '200') {
            validUrls.push(row.URL);
          }

          // Collect issues (301, 302, 404)
          if (['301', '302', '404'].includes(row.Status)) {
            issues.push(row);
          }
        }
      })
      .on('end', () => {
        console.log(
          `Found ${issues.length} issues (301, 302, and 404) in the CSV file`
        );
        resolve({ validUrls, allUrls, issues });
      })
      .on('error', (error) => {
        reject(new Error(`Error parsing CSV: ${error.message}`));
      });
  });
}

/**
 * Creates proper suggestion objects with URL recommendations for 404s
 * @param {Array} issues - Issues from the CSV
 * @param {Array} validUrls - Valid URLs for suggesting alternatives
 * @returns {Array} - Formatted suggestions
 */
function createSuggestions(issues, validUrls) {
  return issues.map((issue) => {
    let urlSuggested = issue['Redirect URL'] || '';

    // For 404s, try to suggest a similar URL
    if (issue.Status === '404' && !urlSuggested) {
      urlSuggested = findSimilarUrl(issue.URL, validUrls);
    }

    return {
      url: issue.URL,
      status: issue.Status,
      urlSuggested: urlSuggested,
    };
  });
}

/**
 * Writes JSON data to a file
 * @param {Object} jsonData - Data to write
 * @param {string} outputPath - Path to write the file
 * @returns {string} - Path to the created file
 */
function writeJSONFile(jsonData, outputPath) {
  try {
    fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`JSON file created at: ${outputPath}`);
    return outputPath;
  } catch (error) {
    throw new Error(`Error writing JSON file: ${error.message}`);
  }
}

/**
 * Main function to convert CSV to JSON
 * @param {string} csvFilePath - Path to CSV file
 * @param {number} sitemapIndex - Index of sitemap in config
 * @returns {Promise<string|null>} - Path to created file or null on error
 */
async function convertCsvToJson(csvFilePath, sitemapIndex = 0) {
  try {
    // Validate inputs
    if (!csvFilePath) {
      throw new Error('CSV file path not provided');
    }

    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`File not found: ${csvFilePath}`);
    }

    console.log(`Reading CSV from: ${csvFilePath}`);

    // Get sitemap configuration
    const { sitemapUrl, siteId } = getSitemapConfig(sitemapIndex);

    // Parse CSV data
    const { validUrls, issues } = await parseCSVData(csvFilePath);

    if (issues.length === 0) {
      console.warn('No issues (301, 302, or 404) found in the CSV file');
      return null;
    }

    // Create suggestions with URL recommendations for 404s
    const suggestions = createSuggestions(issues, validUrls);

    // Create final JSON object in the required format
    const jsonData = {
      opportunity: {
        sitemapUrl: sitemapUrl,
        siteId: siteId,
      },
      suggestions: suggestions,
    };

    // Generate output filename
    const baseName = path.basename(csvFilePath, path.extname(csvFilePath));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.dirname(csvFilePath);
    const jsonFilename = path.join(
      outputDir,
      `${baseName}_json_${timestamp}.json`
    );

    // Write JSON to file
    return writeJSONFile(jsonData, jsonFilename);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

// Run as standalone script
if (require.main === module) {
  // Check if a file path was provided as a command-line argument
  const csvFilePath = process.argv[2];
  const sitemapIndex = parseInt(process.argv[3] || '0', 10); // Optional sitemap index parameter

  if (!csvFilePath) {
    console.error('Please provide a path to a CSV file as an argument');
    console.log('Usage: node csv_to_json.js path/to/report.csv [sitemapIndex]');
    console.log(
      '  sitemapIndex: Optional - index of the sitemap URL in sitemapconfig.js (defaults to 0)'
    );
    process.exit(1);
  }

  // Run the main function
  convertCsvToJson(csvFilePath, sitemapIndex);
} else {
  // Export for use as a module
  module.exports = {
    convertCsvToJson,
    findSimilarUrl,
  };
}
