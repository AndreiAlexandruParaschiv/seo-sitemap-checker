const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { sitemaps } = require('./sitemapconfig');

/**
 * Run a command as a Promise
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @returns {Promise<string>} - Command output
 */
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);

    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      stdout += output;
    });

    proc.stderr.on('data', (data) => {
      const error = data.toString();
      console.error(error);
      stderr += error;
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Finds the most recent file in a directory matching a pattern
 * @param {string} directory - Directory to search
 * @param {RegExp} pattern - Pattern to match
 * @returns {string|null} - Path to the most recent file or null
 */
function findMostRecentFile(directory, pattern) {
  if (!fs.existsSync(directory)) {
    return null;
  }

  const files = fs
    .readdirSync(directory)
    .filter((file) => pattern.test(file))
    .map((file) => ({
      name: file,
      path: path.join(directory, file),
      time: fs.statSync(path.join(directory, file)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time); // Sort by modification time, newest first

  return files.length > 0 ? files[0].path : null;
}

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
 * Converts CSV data to JSON format for the opportunity
 * @param {string} csvPath - Path to the CSV file
 * @param {string} sitemapUrl - URL of the sitemap
 * @param {string} siteId - Site ID
 * @returns {Object} - Opportunity data
 */
async function convertCsvToOpportunityJson(csvPath, sitemapUrl, siteId) {
  // Read data from the CSV file
  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const rows = fileContent
    .split('\n')
    .map((line) => line.split(','))
    .filter((row) => row.length >= 3); // Ensure there are enough columns

  // Extract header row and data rows
  const headers = rows[0];
  const dataRows = rows.slice(1).filter((row) => {
    // Skip summary rows and empty rows
    return (
      row[0] &&
      !row[0].includes('Total URLs Checked:') &&
      !row[0].includes('Successful (200):') &&
      !row[0].includes('Redirects:') &&
      !row[0].includes('Errors:') &&
      !row[0].includes('Not OK Percentage:') &&
      !row[0].includes('Redundant URLs:')
    );
  });

  // Find index of relevant columns
  const urlIndex = headers.findIndex((h) => h === 'URL');
  const statusIndex = headers.findIndex((h) => h === 'Status');
  const redirectUrlIndex = headers.findIndex((h) => h === 'Redirect URL');

  if (urlIndex === -1 || statusIndex === -1 || redirectUrlIndex === -1) {
    throw new Error(
      'CSV file missing required columns (URL, Status, Redirect URL)'
    );
  }

  // Extract all valid URLs (200 status) for suggesting alternatives to 404s
  const validUrls = dataRows
    .filter((row) => row[statusIndex] === '200')
    .map((row) => row[urlIndex]);

  // Process the rows into suggestions
  const suggestions = [];
  for (const row of dataRows) {
    // Check if the row has the necessary data
    if (row[statusIndex] === '301' || row[statusIndex] === '302') {
      suggestions.push({
        url: row[urlIndex],
        status: row[statusIndex],
        urlSuggested: row[redirectUrlIndex] || '',
      });
    } else if (row[statusIndex] === '404') {
      // For 404 errors, try to suggest a similar URL
      const suggestedUrl = findSimilarUrl(row[urlIndex], validUrls);

      suggestions.push({
        url: row[urlIndex],
        status: row[statusIndex],
        urlSuggested: suggestedUrl, // Suggested alternative URL
      });
    }
  }

  console.log(
    `Found ${suggestions.length} issues (redirects and 404s) to include in the opportunity file`
  );

  // Get current timestamp for created and updated times
  const now = new Date().toISOString();

  // Create a new opportunity ID
  const opportunityId = uuidv4();

  // Format suggestions with proper structure
  const formattedSuggestions = suggestions.map((suggestion, index) => {
    return {
      id: uuidv4(), // Generate a UUID for each suggestion
      opportunityId: opportunityId,
      type: 'REDIRECT_UPDATE',
      rank: index,
      status: 'NEW',
      data: {
        sitemapUrl: sitemapUrl,
        pageUrl: suggestion.url,
        type: 'url',
        error: null,
        urlsSuggested: suggestion.urlSuggested,
        statusCode: parseInt(suggestion.status, 10),
      },
      createdAt: now,
      updatedAt: now,
    };
  });

  // Create the complete opportunity object
  return {
    opportunity: {
      id: opportunityId,
      siteId: siteId,
      runbook:
        'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Sitemap_Runbook.docx?d=w6e82533ac43841949e64d73d6809dff3&csf=1&web=1&e=MQKtCx',
      type: 'sitemap',
      origin: 'AUTOMATION',
      title: 'Sitemap issues found',
      status: 'NEW',
      createdAt: now,
      updatedAt: now,
    },
    suggestions: formattedSuggestions,
  };
}

/**
 * Main function to run the sitemap check and create opportunity
 * @param {number} sitemapIndex - Index of the sitemap in the config
 */
async function runSitemapCheckAndCreateOpportunity(sitemapIndex = 0) {
  try {
    // Validate the sitemap index
    if (!sitemaps || sitemaps.length <= sitemapIndex) {
      throw new Error(
        `No sitemap found at index ${sitemapIndex} in sitemapconfig.js`
      );
    }

    const sitemapConfig = sitemaps[sitemapIndex];
    console.log(`Processing sitemap: ${sitemapConfig.url}`);

    // Run the sitemap check
    await runCommand('node', ['sitemap.js', sitemapIndex.toString()]);

    // Extract the domain from the sitemap URL
    const domain = new URL(sitemapConfig.url).hostname.replace(/\./g, '_');
    const resultsDir = path.join(__dirname, 'results', domain);

    // Find the most recent CSV result files for each sitemap
    const csvFiles = {};

    if (fs.existsSync(resultsDir)) {
      const allFiles = fs.readdirSync(resultsDir);
      // Group CSV files by sitemap name
      for (const file of allFiles) {
        if (file.endsWith('.csv')) {
          // Extract the sitemap name from the filename
          const match = file.match(/sitemap_results_(.+?)_\d{4}-\d{2}-\d{2}T/);
          if (match && match[1]) {
            const sitemapName = match[1];
            if (
              !csvFiles[sitemapName] ||
              fs.statSync(path.join(resultsDir, file)).mtime >
                fs.statSync(path.join(resultsDir, csvFiles[sitemapName])).mtime
            ) {
              csvFiles[sitemapName] = file;
            }
          }
        }
      }
    }

    // Process each sitemap result file
    const redirectSitemaps = [];
    for (const sitemapName in csvFiles) {
      const csvPath = path.join(resultsDir, csvFiles[sitemapName]);
      console.log(`Processing CSV file: ${csvPath}`);

      // Check for redirects in the CSV
      const fileContent = fs.readFileSync(csvPath, 'utf8');
      if (
        fileContent.includes('301') ||
        fileContent.includes('302') ||
        fileContent.includes('404')
      ) {
        console.log(
          `Found issues (redirects or 404s) in sitemap: ${sitemapName}`
        );
        redirectSitemaps.push({
          name: sitemapName,
          path: csvPath,
          sitemapUrl: `${sitemapConfig.url.replace(
            'sitemap-index.xml',
            `sitemap-${sitemapName}.xml`
          )}`,
        });
      } else {
        console.log(`No issues found in sitemap: ${sitemapName}`);
      }
    }

    if (redirectSitemaps.length === 0) {
      console.log(
        'No issues (redirects or 404s) found in any sitemap, not creating opportunity file'
      );
      return;
    }

    console.log(`Found issues in ${redirectSitemaps.length} sitemaps`);

    // Create opportunity JSON for each sitemap with redirects
    for (const redirectSitemap of redirectSitemaps) {
      const opportunityData = await convertCsvToOpportunityJson(
        redirectSitemap.path,
        redirectSitemap.sitemapUrl,
        sitemapConfig.siteId
      );

      // Don't create a file if there are no suggestions
      if (opportunityData.suggestions.length === 0) {
        console.log(
          `No suggestions found for ${redirectSitemap.name}, skipping`
        );
        continue;
      }

      // Generate output filename with format: opp-domain-sitemap-M_DD_YYYY
      const date = new Date();
      const month = date.getMonth() + 1; // getMonth() returns 0-11
      const day = date.getDate().toString().padStart(2, '0');
      const year = date.getFullYear();
      const formattedDate = `${month}_${day}_${year}`;

      // Extract just the domain name without the www_ prefix if it exists
      const cleanDomain = domain.startsWith('www_')
        ? domain.substring(4)
        : domain;

      const outputFilePath = path.join(
        resultsDir,
        `opp-${cleanDomain}-sitemap-${formattedDate}.json`
      );

      // Write the opportunity data to a file
      fs.writeFileSync(
        outputFilePath,
        JSON.stringify(opportunityData, null, 2),
        'utf8'
      );
      console.log(`Opportunity file created: ${outputFilePath}`);
      console.log(`Added ${opportunityData.suggestions.length} suggestions`);
    }

    console.log('Process completed successfully');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Check if a sitemap index was provided as a command-line argument
const sitemapIndex = parseInt(process.argv[2] || '0', 10);

// Run the main function
runSitemapCheckAndCreateOpportunity(sitemapIndex);
