import { TransferRecommendation } from "./types";

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-z\s]/g, "")
    .trim();
}

/**
 * Fetch scout picks from AllAboutFPL for a specific gameweek.
 * URL pattern: allaboutfpl.com/YYYY/MM/fpl-gwNN-scout-picks-based-on-stats-analysis-and-matchups/
 * Player names appear as the first <strong> tags in each position section (GK, DEF, MID, FWD).
 */
export async function fetchScoutPicks(gameweek: number): Promise<string[]> {
  const now = new Date();
  // Try current month and previous month (articles may publish early)
  const monthPaths = [
    `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`,
    `${now.getFullYear()}/${String(now.getMonth()).padStart(2, "0")}`,
  ];

  for (const monthPath of monthPaths) {
    const url = `https://allaboutfpl.com/${monthPath}/fpl-gw${gameweek}-scout-picks-based-on-stats-analysis-and-matchups/`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;

      const html = await res.text();
      return parseScoutNames(html);
    } catch {
      continue;
    }
  }

  console.log(`AllAboutFPL scout article not found for GW${gameweek}`);
  return [];
}

function parseScoutNames(html: string): string[] {
  const names: string[] = [];
  const sections = [
    { start: /Scout Picks[^<]*Goalkeeper/i, end: /Scout Picks[^<]*Defenders/i },
    { start: /Scout Picks[^<]*Defenders/i, end: /Scout Picks[^<]*Midfielders/i },
    { start: /Scout Picks[^<]*Midfielders/i, end: /Scout Picks[^<]*Forwards/i },
    { start: /Scout Picks[^<]*Forwards/i, end: /Further reads/i },
  ];

  for (const section of sections) {
    const startMatch = html.match(section.start);
    const endMatch = html.match(section.end);
    if (!startMatch) continue;

    const startIdx = startMatch.index! + startMatch[0].length;
    const endIdx = endMatch ? endMatch.index! : html.length;
    const sectionHtml = html.slice(startIdx, endIdx);

    // First few <strong> tags in each section are player names (short, 1-3 words)
    const strongMatches = sectionHtml.match(/<strong>([^<]{1,30})<\/strong>/gi);
    if (strongMatches) {
      for (const match of strongMatches) {
        const text = match
          .replace(/<\/?strong>/gi, "")
          .replace(/&#8217;/g, "'")
          .replace(/&#8211;/g, "-")
          .trim();
        // Player names are short (1-3 words), no full sentences
        if (text.split(/\s+/).length <= 3 && !text.includes(".") && text.length < 25) {
          names.push(text);
        }
      }
    }
  }

  // Deduplicate
  return [...new Set(names)];
}

export async function crossReferenceExperts(
  recommendations: TransferRecommendation[]
): Promise<TransferRecommendation[]> {
  // Use the old generic approach for transfer recommendations
  const expertNames = await fetchGenericExpertNames();

  if (expertNames.length === 0) return recommendations;

  const normalizedExperts = expertNames.map(normalizePlayerName);

  return recommendations.map((rec) => {
    const webName = normalizePlayerName(rec.playerIn.player.web_name);
    const surname = normalizePlayerName(rec.playerIn.player.second_name);

    const isExpertBacked = normalizedExperts.some(
      (e) => e.includes(webName) || e.includes(surname) || webName.includes(e)
    );

    if (isExpertBacked) {
      return {
        ...rec,
        expertBacked: true,
        reasoning: [...rec.reasoning, "Recommended by FPL experts"],
        priority: rec.priority * 1.2,
      };
    }
    return rec;
  });
}

async function fetchGenericExpertNames(): Promise<string[]> {
  try {
    const res = await fetch(
      "https://www.allaboutfpl.com/category/transfers/",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (res.ok) {
      const html = await res.text();
      const titleMatches = html.match(
        /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<\/h2>/gi
      );
      if (titleMatches) {
        return titleMatches.slice(0, 5).map((t) =>
          t.replace(/<[^>]+>/g, "").trim()
        );
      }
    }
  } catch {
    console.log("Could not fetch expert picks from AllAboutFPL");
  }
  return [];
}
