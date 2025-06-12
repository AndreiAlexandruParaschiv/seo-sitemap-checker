// Shared configuration file for all SEO checking scripts
const sitemaps = [
  // Fill in the sitemaps you want to check with their corresponding siteId
  {
    url: 'https://www.jet2holidays.com/sitemap.xml',
    siteId: '',
  }
];

// For backward compatibility
const sitemapUrls = sitemaps.map((site) => site.url);

module.exports = {
  sitemapUrls,
  sitemaps,
};
