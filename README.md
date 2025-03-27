# SEO Sitemap Checker

This tool provides a comprehensive suite of scripts for checking various SEO aspects of websites using their sitemaps. It handles regular sitemaps (sitemap with URLs) and index sitemaps (sitemap of sitemaps).

## Features

- **URL Status Checking** (sitemap.js): Verifies all URLs in a sitemap, detecting 200 OK responses, redirects, and errors
- **Meta Robots Checking** (noindex.js): Detects pages with noindex/nofollow meta tags that shouldn't be in sitemaps
- **Soft 404 Detection** (soft404.js): Identifies pages that return 200 OK but are actually "soft 404" error pages
- **URL Rechecking** (recheck_urls.js): Rechecks URLs from a previous report to verify if issues have been fixed

Each script generates detailed CSV reports with comprehensive statistics.

## How to use

1. Clone the repository
2. Use node version > v20.0
3. Install the dependencies

```bash
npm install
```

4. Configure the sitemap URLs in the `sitemapconfig.js` file
5. Run any of the scripts:

```bash
# Check URL status (redirects, errors)
node sitemap.js

# Check for noindex/nofollow meta tags
node noindex.js

# Detect soft 404 pages
node soft404.js

# Recheck URLs from a previous report
node recheck_urls.js path/to/report.csv
```

6. Check the results folders:
   - `results` folder for sitemap.js and recheck_urls.js reports
   - `resultsmeta` folder for noindex.js reports
   - `resultssoft404` folder for soft404.js reports

## Configuration

All scripts now use a single shared configuration file: `sitemapconfig.js`

```javascript
// Shared configuration file for all SEO checking scripts
const sitemaps = [
  // Fill in the sitemaps you want to check with their corresponding siteId
  {
    url: 'https://example.com/sitemap.xml',
    siteId: '12345678-1234-1234-1234-123456789abc',
  },
  {
    url: 'https://another-example.com/sitemap.xml',
    siteId: '87654321-4321-4321-4321-cba987654321',
  },
];

// For backward compatibility
const sitemapUrls = sitemaps.map((site) => site.url);

module.exports = {
  sitemapUrls,
  sitemaps,
};
```

The configuration now supports:

- **Full sitemap URLs**: Always include the complete path to the sitemap XML file
- **Site IDs**: Associate each sitemap with its corresponding site ID for opportunity generation
- **Backward compatibility**: Maintains support for older scripts through the sitemapUrls array

This enhanced configuration streamlines the workflow from scanning to opportunity creation, eliminating the need to manually specify site IDs when running the scripts.

### Special Site Requirements

Some sites require special HTTP headers for access:

- **Wilson.com**: All requests to wilson.com automatically include a custom header `eds_process: h9E9Fvp#kvbpq93m` to authenticate requests.

If you need to add additional special headers for other sites, you can modify the relevant request functions in each script.

## URL Status Checking

The sitemap.js script verifies the HTTP status of all URLs in your sitemap, helping you identify issues that could affect your site's SEO performance:

1. **Successful Pages (200)**: Confirms pages that are properly accessible
2. **Redirects (301/302)**: Identifies pages that redirect to other locations
3. **Errors (4xx/5xx)**: Detects broken links and server errors
4. **Redundant URLs**: Identifies URLs that redirect to pages already in the sitemap

The script also provides additional insights:

- Identifies whether redirect targets are also in the sitemap (potentially duplicate content)
- Flags redundant URLs in the report with "Yes" in the "Redundant URL" column
- Handles both regular sitemaps and sitemap index files
- Organizes results by domain for easy analysis
- Provides detailed statistics on the percentage of successful vs problematic URLs

This helps ensure your sitemap accurately represents your site structure and doesn't contain broken or redirecting URLs that waste crawl budget. The redundant URL detection is particularly valuable for eliminating duplicate content issues and improving crawl efficiency.

## Meta Robots Checking

The noindex.js script examines pages in your sitemap to identify those with meta robots directives that prevent search engine indexing. This is important because:

1. Pages with `noindex` tags should not be included in sitemaps as this sends conflicting signals to search engines
2. Pages with `nofollow` tags in sitemaps may waste crawl budget and create confusion about the site's structure

The script:

- Fetches each URL from the sitemap
- Checks for `<meta name="robots">` tags in the HTML
- Identifies both `noindex` and `nofollow` directives
- Generates a detailed report showing which pages have these directives
- Provides statistics on the percentage of compliant vs. non-compliant pages

This helps ensure your sitemap only contains pages that should be indexed, improving your site's SEO efficiency.

## Soft 404 Detection

The soft404.js script detects pages that return a 200 OK status but are actually error pages (soft 404s). It uses a sophisticated detection algorithm that:

1. Looks for strong indicators like "page not found" in page titles, H1 tags, and meta descriptions
2. Checks for multiple weak indicators like minimal content, search results with no matches, etc.
3. Avoids false positives by recognizing legitimate pages based on URL patterns and interactive elements

The script generates detailed reports showing which pages are likely soft 404s and what indicators were found.

## URL Rechecking

The recheck_urls.js script allows you to recheck URLs from a previous report to verify if issues have been fixed:

1. **Targeted Rechecking**: Focuses only on URLs from a specific report rather than the entire sitemap
2. **Status Verification**: Checks if previously identified issues (redirects, errors, etc.) have been resolved
3. **Redundancy Detection**: Continues to identify redundant URLs within the list being checked

To use this script:

```bash
node recheck_urls.js path/to/report.csv
```

The script reads the URLs from the first column of the CSV file and generates a new report with current status information. This is particularly useful for:

- Verifying fixes after making changes to your website
- Monitoring specific problematic URLs over time
- Focusing on a subset of URLs from a larger sitemap

The report follows the same format as the sitemap.js output, making it easy to compare results before and after changes.

## CSV to JSON Conversion

The csv_to_json.js script converts CSV reports from any of the other scripts into a JSON format suitable for importing into other systems:

1. **Selective Export**: Only includes URLs with specific status codes (301, 302, 404)
2. **Structured Format**: Creates a standardized JSON with opportunity and suggestions fields
3. **Sitemap Integration**: Uses the sitemap URL and site ID directly from your sitemapconfig.js file
4. **Automatic Configuration**: Requires minimal parameters as it pulls information from the config file

To use this script:

```bash
node csv_to_json.js path/to/report.csv [sitemapIndex]
```

Parameters:

- `path/to/report.csv`: Path to the CSV report file
- `sitemapIndex` (optional): Index of the sitemap in your sitemapconfig.js file (defaults to 0)

The script creates a JSON file with the following structure:

```json
{
  "opportunity": {
    "sitemapUrl": "https://example.com/sitemap.xml",
    "siteId": "12345678-1234-1234-1234-123456789abc"
  },
  "suggestions": [
    {
      "url": "https://example.com/old-page",
      "status": "301",
      "urlSuggested": "https://example.com/new-page"
    },
    {
      "url": "https://example.com/not-found",
      "status": "404",
      "urlSuggested": ""
    }
  ]
}
```

This format makes it easy to import the results into content management systems, redirect managers, or other SEO tools that expect an "opportunity" object and a "suggestions" array.

## Opportunity File Updates

The update_opportunity.js script allows you to update existing opportunity JSON files with new suggestions:

1. **Metadata Preservation**: Maintains all original opportunity metadata (IDs, titles, etc.)
2. **Suggestion Updates**: Replaces existing suggestions with new ones from a CSV-to-JSON conversion
3. **ID Generation**: Creates new UUIDs for each suggestion while preserving the opportunity ID

To use this script:

```bash
node update_opportunity.js path/to/opportunity.json path/to/suggestions.json
```

Parameters:

- `path/to/opportunity.json`: Path to the existing opportunity file
- `path/to/suggestions.json`: Path to the new suggestions file from csv_to_json.js

The script creates a new JSON file with the original opportunity metadata and the updated suggestions. This is useful for:

- Updating existing opportunities with fresh scan data
- Preserving opportunity tracking information while refreshing the suggestions
- Preparing files for import into opportunity management systems

## Creating Opportunity Files From Scratch

The create_opportunity.js script generates a complete opportunity JSON file from scratch with all required fields:

1. **Auto-Generated Fields**: Creates new UUIDs for the opportunity and all suggestions
2. **Default Values**: Uses predefined values for runbook, title, and status fields
3. **Sitemap Integration**: Extracts the domain from the sitemap URL for filename creation
4. **Site ID Lookup**: Automatically uses site IDs from sitemapconfig.js when available

To use this script:

```bash
node create_opportunity.js path/to/suggestions.json [site-id]
```

Parameters:

- `path/to/suggestions.json`: Path to the suggestions file from csv_to_json.js
- `site-id` (optional): The site ID to use in the opportunity (if not provided, looks up in config)

The script creates a new opportunity file in the following format:

```json
{
  "opportunity": {
    "id": "auto-generated-uuid",
    "siteId": "provided-site-id",
    "runbook": "default-runbook-url",
    "type": "sitemap",
    "origin": "ESS_OPS",
    "title": "Sitemap issues found",
    "status": "NEW",
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  },
  "suggestions": [
    {
      "id": "auto-generated-uuid",
      "opportunityId": "same-as-opportunity-id",
      "type": "REDIRECT_UPDATE",
      "rank": 0,
      "status": "NEW",
      "data": {
        "sitemapUrl": "from-suggestions-file",
        "pageUrl": "url-with-issue",
        "type": "url",
        "error": null,
        "urlsSuggested": "redirect-target",
        "statusCode": 301
      },
      "createdAt": "timestamp",
      "updatedAt": "timestamp"
    }
  ]
}
```

This streamlines the process of creating properly formatted opportunity files ready for import into your management system.
