// Shared configuration file for all SEO checking scripts
const sitemaps = [
  // Fill in the sitemaps you want to check with their corresponding siteId
  {
    url: 'https://domain/sitemap.xml',
    siteId: 'siteId',
  }
];

// For backward compatibility
const sitemapUrls = sitemaps.map((site) => site.url);

module.exports = {
  sitemapUrls,
  sitemaps,
};
