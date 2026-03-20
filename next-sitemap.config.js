/** @type {import('next-sitemap').IConfig} */
module.exports = {
  // VercelでデプロイしたらここをあなたのURLに変更してください
  siteUrl: process.env.SITE_URL || "https://あなたのドメイン.vercel.app",
  generateRobotsTxt: true, // robots.txt も自動生成
  changefreq: "weekly",
  priority: 1.0,
};
