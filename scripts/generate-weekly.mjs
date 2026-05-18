// scripts/generate-weekly.mjs
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from "@anthropic-ai/sdk";
import { generateOgImage, loadFont } from './generate-og-image.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const blogDir = path.resolve(__dirname, '../src/content/blog');

async function getRecentArticles() {
  const files = await fs.readdir(blogDir);
  const now = new Date();
  const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const articles = [];
  for (const file of files) {
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
    
    // Ignore existing weekly-digest to avoid self-loop
    if (file.includes("weekly-digest")) continue;

    const content = await fs.readFile(path.join(blogDir, file), "utf-8");
    const titleMatch = content.match(/title:\s*["']?(.*?)["']?$/m);
    const dateMatch = content.match(/pubDate:\s*["']([^"']+)["']/);
    const descMatch = content.match(/description:\s*["']?(.*?)["']?$/m);
    
    if (titleMatch && dateMatch && descMatch) {
      const pubDate = new Date(dateMatch[1]);
      if (pubDate >= pastWeek) {
        articles.push({
          title: titleMatch[1],
          date: dateMatch[1],
          description: descMatch[1]
        });
      }
    }
  }
  return articles;
}

async function generateWeeklyDigest() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  const articles = await getRecentArticles();
  if (articles.length < 3) {
    console.log("Not enough articles this week to generate a digest.");
    return;
  }

  console.log(`Found ${articles.length} articles from the past week.`);
  const articleSummaries = articles.map(a => `- **${a.title}** (${a.date})\n  ${a.description}`).join('\n\n');

  const client = new Anthropic({ apiKey });
  const MODEL_ID = "claude-sonnet-4-6";

  const prompt = `
    You are an expert AI trend analyst.
    Below is a list of AI news articles we published over the past 7 days:
    
    ${articleSummaries}
    
    CRITICAL INSTRUCTION: Write a "Weekly AI Trends Digest" (今週のAIトレンドまとめ) article based ONLY on these summaries.
    
    The output MUST be exactly in valid Markdown format. Do not wrap in a code block. Starts immediately with frontmatter.
    
    ---
    title: "【週間まとめ】今週のAIトレンドと重要ニュース振り返り"
    description: "今週のAI・テック界隈の重要なニュースをひとまとめ！忙しい方向けにAIの最新動向を1記事でサクッとキャッチアップ。"
    pubDate: "YYYY-MM-DD"
    tags: ["まとめ", "振り返り"]
    slug: "weekly-digest-YYYYMMDD"
    ---
    
    ### ARTICLE STRUCTURE REQUIREMENTS:
    1. **TL;DR Block (3行まとめ)**: IMMEDIATELY after the frontmatter, write exactly 3 bullet points summarizing the overarching trends. Use exactly this format (with blockquote):
       > **💡 今週のポイント**
       > - [トレンド1]
       > - [トレンド2]
       > - [トレンド3]
       
    2. **Introduction**: A short opening wrapping up the vibe of this week's AI news.
    3. **Key Themes (H2)**: Group the articles by overarching themes (e.g., "生成AIの進化", "ビジネス応用の拡大" etc) and summarize what happened.
    4. **Article References**: Use markdown lists to explicitly mention the titles of the news.
    5. **Conclusion**: A brief conclusion on what to expect next week.
    
    Write in natural, engaging Japanese tech-blogger style.
  `;

  try {
    console.log("Generating Weekly Digest with Claude API...");
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    let text = response.content[0].text.trim();

    if (text.startsWith("\`\`\`markdown")) text = text.substring(13, text.length - 3).trim();
    else if (text.startsWith("\`\`\`")) text = text.substring(3, text.length - 3).trim();

    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
    const yyyymmdd = today.toISOString().split('T')[0].replace(/-/g, '');
    
    text = text.replace(/pubDate:\s*["'][^"']+["']/, `pubDate: '${formattedDate}'`);
    text = text.replace(/slug:\s*["'][^"']+["']/, `slug: 'weekly-digest-${yyyymmdd}'`);

    const slug = `weekly-digest-${yyyymmdd}`;
    
    // Generate OG image
    const fontData = await loadFont();
    const outputDir = path.resolve(__dirname, '../public/og');
    await generateOgImage(`【週間まとめ】今週のAIトレンド振り返り`, slug, fontData, outputDir);
    text = text.replace(/---([\s\S]*?)---/, `---\nheroImage: '/og/${slug}.png'\n$1---`);

    const filename = path.join(blogDir, `${slug}.md`);
    await fs.writeFile(filename, text, "utf-8");
    console.log(`✅ Successfully generated weekly digest: ${slug}.md`);

  } catch (error) {
    console.error("Content generation failed", error);
  }
}

generateWeeklyDigest();
