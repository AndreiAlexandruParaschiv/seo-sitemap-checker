const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Usage: node update_opportunity.js <existing-opportunity-file> <new-suggestions-file>

// Get the file paths from command line arguments
const opportunityFilePath = process.argv[2];
const suggestionsFilePath = process.argv[3];

if (!opportunityFilePath || !suggestionsFilePath) {
  console.error('Please provide both files as arguments:');
  console.error(
    'Usage: node update_opportunity.js <existing-opportunity-file> <new-suggestions-file>'
  );
  process.exit(1);
}

// Check if files exist
if (!fs.existsSync(opportunityFilePath)) {
  console.error(`Error: Opportunity file not found: ${opportunityFilePath}`);
  process.exit(1);
}

if (!fs.existsSync(suggestionsFilePath)) {
  console.error(`Error: Suggestions file not found: ${suggestionsFilePath}`);
  process.exit(1);
}

// Read the files
try {
  // Read and parse the existing opportunity file
  const opportunityData = JSON.parse(
    fs.readFileSync(opportunityFilePath, 'utf8')
  );
  console.log(`Read opportunity file: ${opportunityFilePath}`);

  // Read and parse the new suggestions file
  const suggestionsData = JSON.parse(
    fs.readFileSync(suggestionsFilePath, 'utf8')
  );
  console.log(`Read suggestions file: ${suggestionsFilePath}`);

  // Keep the original opportunity metadata
  const opportunityId = opportunityData.opportunity.id;
  const now = new Date().toISOString();

  // Update the existing opportunity with new suggestions
  const updatedSuggestions = suggestionsData.suggestions.map(
    (suggestion, index) => {
      return {
        id: uuidv4(), // Generate a new UUID for each suggestion
        opportunityId: opportunityId,
        type: 'REDIRECT_UPDATE',
        rank: index,
        status: 'NEW',
        data: {
          sitemapUrl: suggestionsData.opportunity.sitemapUrl,
          pageUrl: suggestion.url,
          type: 'url',
          error: null,
          urlsSuggested: suggestion.urlSuggested,
          statusCode: parseInt(suggestion.status, 10),
        },
        createdAt: now,
        updatedAt: now,
      };
    }
  );

  // Create the updated opportunity object
  const updatedOpportunity = {
    opportunity: opportunityData.opportunity,
    suggestions: updatedSuggestions,
  };

  // Update the timestamps
  updatedOpportunity.opportunity.updatedAt = now;

  // Generate output filename
  const outputDir = path.dirname(opportunityFilePath);
  const baseName = path.basename(
    opportunityFilePath,
    path.extname(opportunityFilePath)
  );
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
  const outputFilePath = path.join(
    outputDir,
    `${baseName}_updated_${timestamp}.json`
  );

  // Write the updated opportunity to a new file
  fs.writeFileSync(outputFilePath, JSON.stringify(updatedOpportunity), 'utf8');
  console.log(`Updated opportunity file created: ${outputFilePath}`);
  console.log(`Added ${updatedSuggestions.length} new suggestions`);
} catch (error) {
  console.error(`Error processing files: ${error.message}`);
  process.exit(1);
}
