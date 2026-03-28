import { TransferRecommendation } from "./types";

interface ExpertPick {
  name: string;
  source: string;
}

async function fetchExpertPicks(): Promise<ExpertPick[]> {
  const picks: ExpertPick[] = [];

  try {
    // Fetch from AllAboutFPL or similar sites
    // Using a simple approach: fetch the page and parse for player names
    const res = await fetch("https://www.allaboutfpl.com/category/transfers/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const html = await res.text();
      // Extract player names mentioned in transfer articles
      // Look for common patterns in article titles/content
      const titleMatches = html.match(
        /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<\/h2>/gi
      );
      if (titleMatches) {
        for (const title of titleMatches.slice(0, 5)) {
          const text = title.replace(/<[^>]+>/g, "").trim();
          picks.push({ name: text, source: "AllAboutFPL" });
        }
      }
    }
  } catch {
    // Scraping failed — continue without expert data
    console.log("Could not fetch expert picks from AllAboutFPL");
  }

  return picks;
}

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-z\s]/g, "")
    .trim();
}

export async function crossReferenceExperts(
  recommendations: TransferRecommendation[]
): Promise<TransferRecommendation[]> {
  const expertPicks = await fetchExpertPicks();

  if (expertPicks.length === 0) return recommendations;

  const expertText = expertPicks
    .map((p) => normalizePlayerName(p.name))
    .join(" ");

  return recommendations.map((rec) => {
    const playerName = normalizePlayerName(
      `${rec.playerIn.player.first_name} ${rec.playerIn.player.second_name}`
    );
    const webName = normalizePlayerName(rec.playerIn.player.web_name);

    const isExpertBacked =
      expertText.includes(playerName) ||
      expertText.includes(webName) ||
      expertText.includes(normalizePlayerName(rec.playerIn.player.second_name));

    if (isExpertBacked) {
      return {
        ...rec,
        expertBacked: true,
        reasoning: [...rec.reasoning, "Recommended by FPL experts"],
        priority: rec.priority * 1.2, // 20% boost for expert-backed picks
      };
    }
    return rec;
  });
}
