import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const outputDir = new URL("../apps/web/public/assets/docs/", import.meta.url).pathname;
await mkdir(outputDir, { recursive: true });

const palette = {
  ink: "#2a1c20",
  muted: "#746b65",
  orange: "#ef5b36",
  orangeSoft: "#ffe1d5",
  cream: "#fffaf1",
  sage: "#dfeadb",
  blue: "#dceaf8",
  purple: "#eadff0",
  red: "#f7d9d5",
  white: "#ffffff"
};

const diagrams = [
  {
    name: "system-overview",
    title: "Moodish system overview",
    width: 1500,
    height: 760,
    nodes: [
      box("person", 40, 280, 180, 105, "Person\nmood + limits", palette.orangeSoft),
      box("surfaces", 285, 160, 230, 345, "PRODUCT SURFACES\n\nSolo chat\nEnterprise web\nSlack · Teams · Discord\nMoodish MCP", palette.cream),
      box("agent", 595, 160, 265, 345, "MOODISH AGENT\n\nConversation state\nValidated intent\nHard constraints\nDeterministic ranking\nCart confirmation", palette.sage),
      box("swiggy", 950, 75, 240, 205, "SWIGGY GATEWAY\n\nOAuth 2.1 + PKCE\nFood MCP\nInstamart MCP", palette.blue),
      box("ai", 950, 345, 240, 150, "AI PROVIDER\n\nSemantic intent + tone\nCannot change ranking", palette.purple),
      box("memory", 610, 15, 235, 115, "PERSISTENCE\nPostgres prod · memory local", palette.cream),
      box("cart", 610, 540, 235, 105, "CART BOUNDARY\nFood write · IM preview", palette.orangeSoft)
    ],
    edges: [
      edge("person", "surfaces", "request"),
      edge("surfaces", "agent", "API / MCP"),
      edge("agent", "swiggy"),
      edge("agent", "ai"),
      edge("agent", "memory"),
      edge("agent", "cart")
    ],
    notes: [
      note(930, 590, 500, "Truth boundary: ranking is deterministic. AI phrasing is post-ranking and is overridden if it contradicts the top option.")
    ]
  },
  {
    name: "user-journeys",
    title: "Solo and enterprise user journeys",
    width: 1500,
    height: 760,
    nodes: [
      label(35, 35, "SOLO"),
      box("s1", 130, 55, 190, 105, "Sign in\nGoogle / Swiggy", palette.cream),
      box("s2", 380, 55, 190, 105, "Say the mood\nor full request", palette.orangeSoft),
      box("s3", 630, 55, 190, 105, "Answer only\nmissing hard fields", palette.cream),
      box("s4", 880, 55, 190, 105, "Compare ranked\nmeal plans", palette.sage),
      box("s5", 1130, 55, 190, 105, "Select pairings\noptional IM", palette.blue),
      box("s6", 1325, 55, 145, 105, "Review\ncart previews", palette.orangeSoft),
      label(35, 285, "ENTERPRISE"),
      box("g1", 130, 305, 190, 110, "Manager sets\npolicy + mode", palette.cream),
      box("g2", 380, 305, 190, 110, "Private link\ncollects needs", palette.orangeSoft),
      box("g3", 630, 305, 190, 110, "Close collection\nrank plans", palette.sage),
      box("g4", 880, 305, 190, 110, "Manager decides\nor team votes", palette.blue),
      box("g5", 1130, 305, 190, 110, "Creator confirms\nFood cart", palette.orangeSoft),
      box("g6", 1325, 305, 145, 110, "Checkout\nstill blocked", palette.red)
    ],
    edges: [
      edge("s1", "s2"), edge("s2", "s3"), edge("s3", "s4"), edge("s4", "s5"), edge("s5", "s6"),
      edge("g1", "g2"), edge("g2", "g3"), edge("g3", "g4"), edge("g4", "g5"), edge("g5", "g6")
    ],
    notes: [
      note(130, 515, 590, "Private participant submissions contain cravings, dietary rules and allergies. Public surfaces receive only aggregate coverage."),
      note(800, 515, 590, "One restaurant is preferred first. Split orders are a disclosed fallback, not a hidden optimization.")
    ]
  },
  {
    name: "ai-boundary",
    title: "How AI is and is not used",
    width: 1500,
    height: 760,
    nodes: [
      box("input", 55, 270, 200, 120, "Natural language\n“chewy chaap,\nveg, under ₹400”", palette.orangeSoft),
      box("extract", 335, 95, 270, 240, "AI SEMANTIC LAYER\n\nStrict JSON schema\nCraving meaning\nPlan-edit detection\nWarm acknowledgement", palette.purple),
      box("fallback", 335, 430, 270, 145, "SAFE FALLBACK\n\nRegex hard fields\nPrevious state merge\nProvider outage path", palette.cream),
      box("rank", 690, 95, 290, 240, "DETERMINISTIC ENGINE\n\nAvailability + diet\nDish relevance\nBudget ceiling\nDistance + rating\nDiscovery tie-break", palette.sage),
      box("summary", 1065, 95, 270, 240, "OPTIONAL AI\n\nReceives top options\nWrites one sentence\nNo hidden profile\nNo tool execution", palette.purple),
      box("guard", 1065, 430, 270, 145, "OUTPUT GUARD\n\nTop restaurant must lead\nElse deterministic text", palette.orangeSoft),
      box("result", 690, 430, 290, 145, "USER RESULT\n\nRanked cards\nExact / alternative labels\nTrace + data source", palette.blue)
    ],
    edges: [
      edge("input", "extract", "message + state"),
      edge("input", "fallback", "fallback"),
      edge("extract", "rank", "structured intent"),
      edge("fallback", "rank", "validated fields"),
      edge("rank", "summary", "top options"),
      edge("summary", "guard", "sentence"),
      edge("guard", "result", "safe copy"),
      edge("rank", "result", "ranking")
    ],
    notes: [
      note(325, 620, 1010, "AI understands language and writes friendly copy. Deterministic code still validates hard fields, chooses Swiggy operations, applies constraints, ranks candidates and gates every cart write.")
    ]
  },
  {
    name: "swiggy-call-lifecycle",
    title: "Expected Swiggy MCP call lifecycle",
    width: 1700,
    height: 980,
    nodes: [
      box("oauth1", 40, 50, 220, 105, "POST /auth/register\nDynamic client", palette.cream),
      box("oauth2", 315, 50, 220, 105, "GET /auth/authorize\nOTP + PKCE", palette.orangeSoft),
      box("oauth3", 590, 50, 220, 105, "POST /auth/token\nEncrypted session", palette.sage),
      box("addr", 40, 285, 220, 105, "food.get_addresses\n{} ", palette.blue),
      box("intent", 315, 285, 220, 105, "Moodish intent\nexact dish?", palette.cream),
      box("menu", 590, 225, 260, 135, "food.search_menu\naddressId · query\nvegFilter", palette.orangeSoft),
      box("rest", 590, 410, 260, 135, "food.search_restaurants\naddressId · query", palette.orangeSoft),
      box("hydrate", 935, 315, 275, 135, "food.get_restaurant_menu\nrestaurantId · addressId", palette.sage),
      box("im", 1295, 225, 265, 135, "im.search_products\naddressId · pairing query\nOPTIONAL", palette.purple),
      box("rank2", 1295, 410, 265, 135, "Moodish filters + ranks\nNo Swiggy write", palette.blue),
      box("confirm", 935, 650, 275, 125, "Explicit user confirm\nselected meal + add-ons", palette.cream),
      box("foodcart", 1295, 625, 265, 145, "food.update_food_cart\nrestaurantId · addressId\nitemId · quantity", palette.orangeSoft),
      box("impreview", 1295, 815, 265, 110, "Instamart preview only\nNO cart mutation", palette.red),
      box("notcalled", 40, 650, 700, 275, "NOT CALLED / NOT IMPLEMENTED\n\n• Swiggy checkout or order placement\n• Swiggy order-history read\n• Instamart cart update\n• Full pagination traversal\n• Variant and add-on resolution\n• Payment or delivery scheduling", palette.red)
    ],
    edges: [
      edge("oauth1", "oauth2"), edge("oauth2", "oauth3"),
      edge("addr", "intent", "addressId"),
      edge("intent", "menu", "dish request"),
      edge("intent", "rest", "vague / cuisine"),
      edge("menu", "hydrate"), edge("rest", "hydrate"),
      edge("hydrate", "im", "remaining budget"),
      edge("hydrate", "rank2"), edge("im", "rank2"),
      edge("rank2", "confirm", "shortlist"),
      edge("confirm", "foodcart"),
      edge("confirm", "impreview")
    ],
    notes: [
      note(900, 50, 660, "Bearer access token is attached to every Food and Instamart JSON-RPC tool call.")
    ]
  }
];

for (const diagram of diagrams) {
  const svg = renderSvg(diagram);
  const scene = renderExcalidraw(diagram);
  await writeFile(join(outputDir, `${diagram.name}.svg`), svg);
  await writeFile(join(outputDir, `${diagram.name}.excalidraw`), JSON.stringify(scene, null, 2));
  try {
    const sharp = require("sharp");
    await sharp(Buffer.from(svg)).png().toFile(join(outputDir, `${diagram.name}.png`));
  } catch (error) {
    console.warn(`PNG export skipped for ${diagram.name}: ${error.message}`);
  }
}

function box(id, x, y, width, height, text, fill) {
  return { id, type: "box", x, y, width, height, text, fill };
}

function label(x, y, text) {
  return { id: `label-${text}`, type: "label", x, y, width: 80, height: 30, text };
}

function note(x, y, width, text) {
  return { id: `note-${x}-${y}`, type: "note", x, y, width, height: 90, text, fill: palette.cream };
}

function edge(from, to, text = "") {
  return { from, to, text };
}

function renderSvg(diagram) {
  const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${palette.ink}"/></marker><filter id="rough"><feTurbulence baseFrequency=".008" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.1"/></filter></defs>`;
  const byId = new Map([...diagram.nodes, ...(diagram.notes || [])].map((item) => [item.id, item]));
  const arrows = diagram.edges.map((item) => {
    const from = byId.get(item.from);
    const to = byId.get(item.to);
    const start = edgePoint(from, to);
    const end = edgePoint(to, from);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    return `<path d="M ${start.x} ${start.y} L ${end.x} ${end.y}" fill="none" stroke="${palette.ink}" stroke-width="2.8" marker-end="url(#arrow)"/>${
      item.text ? `<g><rect x="${midX - Math.max(34, item.text.length * 4.8)}" y="${midY - 25}" width="${Math.max(68, item.text.length * 9.6)}" height="24" rx="6" fill="${palette.white}"/><text x="${midX}" y="${midY - 8}" text-anchor="middle" font-size="15" fill="${palette.muted}">${escapeXml(item.text)}</text></g>` : ""
    }`;
  }).join("");
  const shapes = [...diagram.nodes, ...(diagram.notes || [])].map((item) => renderSvgNode(item)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${diagram.width}" height="${diagram.height}" viewBox="0 0 ${diagram.width} ${diagram.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(diagram.title)}</title>
  <desc id="desc">Editable source is provided as an Excalidraw scene beside this exported image.</desc>
  ${defs}
  <rect width="100%" height="100%" fill="${palette.white}"/>
  ${shapes}
  ${arrows}
</svg>`;
}

function renderSvgNode(item) {
  if (item.type === "label") {
    return `<text x="${item.x}" y="${item.y}" font-family="Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="3" fill="${palette.orange}">${escapeXml(item.text)}</text>`;
  }
  const radius = item.type === "note" ? 8 : 18;
  const fontSize = item.type === "note" ? 18 : 19;
  const lines = wrapLines(item.text, Math.max(12, Math.floor(item.width / (fontSize * 0.57))));
  const lineHeight = fontSize * 1.35;
  const totalHeight = lines.length * lineHeight;
  const startY = item.y + Math.max(26, (item.height - totalHeight) / 2 + fontSize);
  return `<g filter="url(#rough)">
    <rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="${radius}" fill="${item.fill || palette.cream}" stroke="${palette.ink}" stroke-width="2"/>
    ${lines.map((line, index) => `<text x="${item.x + item.width / 2}" y="${startY + index * lineHeight}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${index === 0 && item.type !== "note" ? 700 : 400}" fill="${palette.ink}">${escapeXml(line)}</text>`).join("")}
  </g>`;
}

function edgePoint(from, to) {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: dx > 0 ? from.x + from.width : from.x, y: fromCenter.y };
  }
  return { x: fromCenter.x, y: dy > 0 ? from.y + from.height : from.y };
}

function renderExcalidraw(diagram) {
  const elements = [];
  const byId = new Map(diagram.nodes.map((item) => [item.id, item]));
  let index = 0;
  for (const item of [...diagram.nodes, ...(diagram.notes || [])]) {
    if (item.type === "label") {
      elements.push(textElement(item, index++));
      continue;
    }
    elements.push(rectElement(item, index++));
    elements.push(textElement(item, index++));
  }
  for (const item of diagram.edges) {
    const from = byId.get(item.from);
    const to = byId.get(item.to);
    const start = edgePoint(from, to);
    const end = edgePoint(to, from);
    elements.push(arrowElement(start, end, index++));
    if (item.text) {
      elements.push(textElement({
        id: `edge-label-${index}`,
        x: (start.x + end.x) / 2 - 70,
        y: (start.y + end.y) / 2 - 30,
        width: 140,
        height: 24,
        text: item.text,
        type: "label"
      }, index++));
    }
  }
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: palette.white
    },
    files: {}
  };
}

function commonElement(id, type, x, y, width, height, index) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: palette.ink,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: `a${index}`,
    roundness: null,
    seed: 1000 + index * 37,
    version: 1,
    versionNonce: 2000 + index * 41,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false
  };
}

function rectElement(item, index) {
  return {
    ...commonElement(item.id, "rectangle", item.x, item.y, item.width, item.height, index),
    backgroundColor: item.fill || palette.cream,
    roundness: { type: 3 }
  };
}

function textElement(item, index) {
  const fontSize = item.type === "label" ? 22 : item.type === "note" ? 18 : 19;
  return {
    ...commonElement(`${item.id}-text`, "text", item.x + 12, item.y + 12, item.width - 24, item.height - 24, index),
    strokeColor: item.type === "label" ? palette.orange : palette.ink,
    text: item.text,
    fontSize,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: null,
    originalText: item.text,
    autoResize: false,
    lineHeight: 1.25
  };
}

function arrowElement(start, end, index) {
  return {
    ...commonElement(`arrow-${index}`, "arrow", start.x, start.y, end.x - start.x, end.y - start.y, index),
    points: [[0, 0], [end.x - start.x, end.y - start.y]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false
  };
}

function wrapLines(value, maxChars) {
  return String(value).split("\n").flatMap((paragraph) => {
    if (!paragraph) return [""];
    const words = paragraph.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      if (!line || `${line} ${word}`.length <= maxChars) line = line ? `${line} ${word}` : word;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  });
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;"
  })[character]);
}
