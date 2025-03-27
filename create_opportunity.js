const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sitemapConfig = require('./sitemapconfig');

/**
 * Default runbook URL for sitemap opportunities
 */
const DEFAULT_RUNBOOK =
  'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Sitemap_Runbook.docx?d=w6e82533ac43841949e64d73d6809dff3&csf=1&web=1&e=MQKtCx';

/**
 * Reads and parses a JSON file
 * @param {string} filePath - Path to the JSON file
 * @returns {Object} - Parsed JSON data
 * @throws {Error} If file doesn't exist or can't be parsed
 */
function readJSONFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Error reading or parsing JSON file: ${error.message}`);
  }
}

/**
 * Writes JSON data to a file
 * @param {Object} data - Data to write
 * @param {string} filePath - Path to write to
 * @returns {string} - Path to the created file
 * @throws {Error} If file can't be written
 */
function writeJSONFile(data, filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return filePath;
  } catch (error) {
    throw new Error(`Error writing JSON file: ${error.message}`);
  }
}

/**
 * Extracts the domain from a URL
 * @param {string} url - URL to extract domain from
 * @returns {string} - Domain name formatted for filenames
 */
function extractDomainFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.replace(/\./g, '-');
  } catch (error) {
    console.warn(`Could not parse URL: ${error.message}`);
    return 'unknown-site';
  }
}

/**
 * Find site ID from config by URL
 * @param {string} sitemapUrl - URL to find in config
 * @returns {string|null} - Site ID if found
 */
function findSiteIdInConfig(sitemapUrl) {
  if (!sitemapUrl || !sitemapConfig.sitemaps) {
    return null;
  }

  const siteConfig = sitemapConfig.sitemaps.find(
    (site) => site.url === sitemapUrl
  );

  return siteConfig?.siteId || null;
}

/**
 * Creates formatted suggestions objects for the opportunity
 * @param {Array} suggestions - Raw suggestions data
 * @param {string} opportunityId - ID of the opportunity
 * @param {string} sitemapUrl - URL of the sitemap
 * @returns {Array} - Formatted suggestions
 */
function formatSuggestions(suggestions, opportunityId, sitemapUrl) {
  const now = new Date().toISOString();

  return suggestions.map((suggestion, index) => {
    return {
      id: uuidv4(),
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
}

/**
 * Creates opportunity data structure
 * @param {string} opportunityId - ID for the opportunity
 * @param {string} siteId - Site ID
 * @param {Array} formattedSuggestions - Formatted suggestions
 * @param {Object} options - Additional options
 * @returns {Object} - Complete opportunity data
 */
function createOpportunityData(
  opportunityId,
  siteId,
  formattedSuggestions,
  options = {}
) {
  const now = new Date().toISOString();

  return {
    opportunity: {
      id: opportunityId,
      siteId: siteId,
      runbook: options.runbook || DEFAULT_RUNBOOK,
      type: options.type || 'sitemap',
      origin: options.origin || 'AUTOMATION',
      title: options.title || 'Sitemap issues found',
      status: options.status || 'NEW',
      createdAt: now,
      updatedAt: now,
    },
    suggestions: formattedSuggestions,
  };
}

/**
 * Generates a filename for the opportunity file
 * @param {string} basePath - Base directory path
 * @param {string} siteDomain - Domain name for the file
 * @param {Object} options - Optional parameters
 * @returns {string} - Complete file path
 */
function generateFilename(basePath, siteDomain, options = {}) {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear();
  const formattedDate = options.useCustomDateFormat
    ? `${month}_${day}_${year}`
    : date.toISOString().slice(0, 10).replace(/-/g, '_');

  return path.join(
    basePath,
    `opp-${siteDomain}-sitemap-${formattedDate}${options.suffix || ''}.json`
  );
}

/**
 * Main function to create an opportunity from suggestions file
 * @param {string} suggestionsFilePath - Path to suggestions JSON file
 * @param {string} providedSiteId - Optional explicit site ID
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - Path to created opportunity file
 */
async function createOpportunity(
  suggestionsFilePath,
  providedSiteId = null,
  options = {}
) {
  try {
    // Read and validate the suggestions file
    const suggestionsData = readJSONFile(suggestionsFilePath);
    console.log(`Read suggestions file: ${suggestionsFilePath}`);

    if (
      !suggestionsData.suggestions ||
      !Array.isArray(suggestionsData.suggestions)
    ) {
      throw new Error(
        'Invalid suggestions file: missing or invalid suggestions array'
      );
    }

    // Extract sitemap URL from the suggestions data
    const sitemapUrl = suggestionsData.opportunity?.sitemapUrl;
    if (!sitemapUrl) {
      console.warn('Warning: No sitemap URL found in suggestions file');
    }

    // Determine the site ID to use
    let siteId = providedSiteId;

    // If no site ID was provided, try to find it in the config
    if (!siteId && sitemapUrl) {
      siteId = findSiteIdInConfig(sitemapUrl);
      if (siteId) {
        console.log(`Using site ID from config: ${siteId}`);
      }
    }

    // If still no site ID, use a fallback
    if (!siteId) {
      siteId = options.fallbackSiteId || '00000000-0000-0000-0000-000000000000';
      console.warn(
        `Warning: No site ID provided or found in config. Using fallback ID: ${siteId}`
      );
    }

    // Generate a new opportunity ID
    const opportunityId = uuidv4();

    // Extract site domain from sitemapUrl for the filename
    const siteDomain = sitemapUrl
      ? extractDomainFromUrl(sitemapUrl)
      : options.siteDomain || 'unknown-site';

    // Format the suggestions
    const formattedSuggestions = formatSuggestions(
      suggestionsData.suggestions,
      opportunityId,
      sitemapUrl
    );

    // Create the complete opportunity object
    const opportunityData = createOpportunityData(
      opportunityId,
      siteId,
      formattedSuggestions,
      options
    );

    // Generate output filename
    const outputDir = options.outputDir || path.dirname(suggestionsFilePath);
    const outputFilePath = generateFilename(outputDir, siteDomain, options);

    // Write the opportunity data to a new file
    writeJSONFile(opportunityData, outputFilePath);

    console.log(`New opportunity file created: ${outputFilePath}`);
    console.log(`Opportunity ID: ${opportunityId}`);
    console.log(`Site ID: ${siteId}`);
    console.log(`Added ${formattedSuggestions.length} suggestions`);

    return outputFilePath;
  } catch (error) {
    console.error(`Error creating opportunity: ${error.message}`);
    throw error;
  }
}

// Run as standalone script if not imported as a module
if (require.main === module) {
  // Get the file paths from command line arguments
  const suggestionsFilePath = process.argv[2];
  const providedSiteId = process.argv[3]; // Optional site ID from command line

  if (!suggestionsFilePath) {
    console.error('Please provide a suggestions file path as an argument:');
    console.error(
      'Usage: node create_opportunity.js <suggestions-file> [site-id]'
    );
    process.exit(1);
  }

  // Set custom options for standalone usage
  const options = {
    useCustomDateFormat: true, // Use M_DD_YYYY format
    origin: 'AUTOMATION',
  };

  // Execute the function
  createOpportunity(suggestionsFilePath, providedSiteId, options).catch(
    (error) => {
      console.error(`Failed to create opportunity: ${error.message}`);
      process.exit(1);
    }
  );
} else {
  // Export functions for use as a module
  module.exports = {
    createOpportunity,
    formatSuggestions,
    findSiteIdInConfig,
    extractDomainFromUrl,
  };
}
