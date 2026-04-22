// Google Sheets — Render 等: GOOGLE_SERVICE_ACCOUNT_JSON（サービスアカウント JSON 全文）
// Replit: 従来どおり REPL_IDENTITY + REPLIT_CONNECTORS_HOSTNAME のコネクター
import { google } from "googleapis";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function parseServiceAccountJson(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.client_email !== "string" || typeof obj.private_key !== "string") {
      throw new Error("missing client_email or private_key");
    }
    return obj;
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON が不正です。サービスアカウントの JSON を1行に整形して設定してください。",
    );
  }
}

export async function getUncachableGoogleSheetClient() {
  const credentials = parseServiceAccountJson();
  if (credentials) {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [SHEETS_SCOPE],
    });
    return google.sheets({ version: "v4", auth });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    const auth = new google.auth.GoogleAuth({
      scopes: [SHEETS_SCOPE],
    });
    return google.sheets({ version: "v4", auth });
  }

  const accessToken = await getReplitConnectorAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

// ---- Replit Google Sheet connector (legacy) ----
let connectionSettings: any;

async function getReplitConnectorAccessToken() {
  if (
    connectionSettings &&
    connectionSettings.settings.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken || !hostname) {
    throw new Error(
      "Google Sheets 未設定です。Render では環境変数 GOOGLE_SERVICE_ACCOUNT_JSON（サービスアカウント JSON）を設定し、スプレッドシートをその client_email に共有してください。Replit の場合は Google Sheet コネクタを接続してください。",
    );
  }

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=google-sheet",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Google Sheet not connected");
  }
  return accessToken;
}

async function getSheetId(spreadsheetId: string, sheetName: string): Promise<number | null> {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === sheetName
  );
  return sheet?.properties?.sheetId ?? null;
}

// ---- セドリリスト (30 columns A:AD) ----
// Group layout (for color coding):
//   基本情報  A-C  (登録日・商品名・ステータス)
//   仕入情報  D-E  (仕入先・仕入値)
//   eBay価格  F-G  (eBay$・eBay¥)
//   諸経費   H-K  (手数料・発送代行費・その他・合計)
//   利益     L-M  (推定利益・利益率)
//   実績     N-O  (実売価格・実利益)
//   出品     P-Q  (出品価格・重量)
//   落札相場 R-T  (相場平均・最安・最高)
//   リンク   U-W  (eBay URL・仕入先URL・メモ)
//   出品詳細 X-AD (タイトル・コンディション・カテゴリID・カテゴリ名・説明文・写真URL・ItemSpecifics)
const SEDORI_HEADERS = [
  "登録日",              // A
  "商品名",              // B
  "ステータス",           // C
  "仕入先",              // D
  "仕入値(¥)",           // E
  "eBay価格($)",         // F
  "eBay円換算(¥)",       // G
  "eBay手数料(¥)",       // H
  "発送代行費(¥)",        // I
  "その他費用(¥)",        // J
  "合計諸経費(¥)",        // K
  "推定利益(¥)",          // L
  "利益率(%)",            // M
  "実売価格($)",          // N
  "実利益(¥)",            // O
  "出品価格($)",          // P
  "重量(g)",             // Q
  "落札相場平均(¥)",      // R
  "落札相場最安(¥)",      // S
  "落札相場最高(¥)",      // T
  "eBay URL",            // U
  "仕入先URL",            // V
  "メモ",                // W
  "出品タイトル",          // X
  "コンディション",        // Y
  "カテゴリID",           // Z
  "カテゴリ名",           // AA
  "説明文",              // AB
  "写真URL",             // AC
  "ItemSpecifics(JSON)", // AD
];

const SEDORI_RANGE = "A:AD";

export async function ensureSheetExists(spreadsheetId: string, sheetName: string) {
  const sheets = await getUncachableGoogleSheetClient();

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets || [];
  const sheetExists = existingSheets.some(
    (s) => s.properties?.title === sheetName
  );

  if (!sheetExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName,
              gridProperties: { rowCount: 1000, columnCount: 30 },
            },
          },
        }],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:AD1`,
      valueInputOption: "RAW",
      requestBody: { values: [SEDORI_HEADERS] },
    });

    const sheetId = await getSheetId(spreadsheetId, sheetName);
    if (sheetId !== null) {
      await applySheetHeaderFormatting(sheets, spreadsheetId, sheetId);
    }
  }

  return sheetExists;
}

// Column group colors for the header row (0-based column index ranges)
const COLUMN_GROUPS = [
  { start: 0,  end: 3,  r: 0.25, g: 0.32, b: 0.71 }, // A-C 基本情報  (紺)
  { start: 3,  end: 5,  r: 0.13, g: 0.55, b: 0.45 }, // D-E 仕入情報  (緑)
  { start: 5,  end: 7,  r: 0.18, g: 0.46, b: 0.80 }, // F-G eBay価格  (青)
  { start: 7,  end: 11, r: 0.70, g: 0.25, b: 0.18 }, // H-K 諸経費    (赤)
  { start: 11, end: 13, r: 0.20, g: 0.60, b: 0.30 }, // L-M 利益      (緑濃)
  { start: 13, end: 15, r: 0.50, g: 0.30, b: 0.65 }, // N-O 実績      (紫)
  { start: 15, end: 17, r: 0.70, g: 0.45, b: 0.10 }, // P-Q 出品      (橙)
  { start: 17, end: 20, r: 0.20, g: 0.55, b: 0.65 }, // R-T 落札相場  (水色)
  { start: 20, end: 23, r: 0.35, g: 0.35, b: 0.35 }, // U-W リンク    (灰)
  { start: 23, end: 30, r: 0.42, g: 0.22, b: 0.58 }, // X-AD 出品詳細  (紫紺)
];

async function applySheetHeaderFormatting(
  sheets: any, spreadsheetId: string, sheetId: number
) {
  const requests: any[] = [];

  // Apply color per column group
  for (const g of COLUMN_GROUPS) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: g.start, endColumnIndex: g.end },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: g.r, green: g.g, blue: g.b },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
              fontSize: 10,
            },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "CLIP",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
      },
    });
  }

  // Freeze first row + set row height to 28px
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: "gridProperties.frozenRowCount",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 30 },
      fields: "pixelSize",
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

type ProductForSheet = {
  name: string;
  listingStatus?: string | null;
  ebayPrice?: number | null;
  ebayPriceJpy?: number | null;
  ebayFeeRate?: number | null;   // % e.g. 13.25
  otherFees?: number | null;     // ¥
  listingPrice?: number | null;
  actualSalePrice?: number | null;
  sourcePrice?: number | null;
  forwardingCost?: number | null;
  profit?: number | null;
  profitRate?: number | null;
  actualProfit?: number | null;
  ebayUrl?: string | null;
  sourcePlatform?: string | null;
  sourceUrl?: string | null;
  weight?: number | null;
  notes?: string | null;
  createdAt?: Date | null;
  marketAvgJpy?: number | null;
  marketMinJpy?: number | null;
  marketMaxJpy?: number | null;
  // Listing detail fields (X-AD)
  listingTitle?: string | null;
  ebayCondition?: string | null;
  ebayCategoryId?: string | null;
  ebayCategoryPath?: string | null;
  listingDescription?: string | null;
  imageUrls?: string[] | null;
  listingItemSpecifics?: string | null; // JSON string
};

// A-W: 財務データ / X-AD: 出品詳細
function buildSheetRow(product: ProductForSheet): string[] {
  const ebayPriceJpy = product.ebayPriceJpy ?? 0;
  const ebayFeeRate = product.ebayFeeRate ?? 13.25;
  const ebayFeeAmount = Math.round(ebayPriceJpy * (ebayFeeRate / 100));
  const forwardingCost = product.forwardingCost ?? 0;
  const otherFees = product.otherFees ?? 0;
  const totalCosts = ebayFeeAmount + forwardingCost + otherFees;
  const sourcePrice = product.sourcePrice ?? 0;
  const estimatedProfit = product.profit != null ? product.profit : (ebayPriceJpy > 0 ? ebayPriceJpy - totalCosts - sourcePrice : 0);
  const profitRate = product.profitRate != null ? product.profitRate : (ebayPriceJpy > 0 ? (estimatedProfit / ebayPriceJpy) * 100 : 0);

  const dateStr = product.createdAt
    ? new Date(product.createdAt).toLocaleDateString("ja-JP")
    : new Date().toLocaleDateString("ja-JP");

  return [
    dateStr,                                                           // A: 登録日
    product.name ?? "",                                               // B: 商品名
    product.listingStatus ?? "仕入中",                                // C: ステータス
    product.sourcePlatform ?? "",                                     // D: 仕入先
    product.sourcePrice != null ? String(product.sourcePrice) : "",  // E: 仕入値(¥)
    product.ebayPrice != null ? `$${product.ebayPrice.toFixed(2)}` : "", // F: eBay価格($)
    ebayPriceJpy > 0 ? String(ebayPriceJpy) : "",                   // G: eBay円換算(¥)
    ebayPriceJpy > 0 ? String(ebayFeeAmount) : "",                   // H: eBay手数料(¥)
    forwardingCost > 0 ? String(forwardingCost) : "",                // I: 発送代行費(¥)
    otherFees > 0 ? String(otherFees) : "",                          // J: その他費用(¥)
    ebayPriceJpy > 0 ? String(totalCosts) : "",                      // K: 合計諸経費(¥)
    ebayPriceJpy > 0 ? String(estimatedProfit) : "",                 // L: 推定利益(¥)
    ebayPriceJpy > 0 ? `${profitRate.toFixed(1)}%` : "",            // M: 利益率(%)
    product.actualSalePrice != null ? `$${product.actualSalePrice.toFixed(2)}` : "", // N: 実売価格($)
    product.actualProfit != null ? String(product.actualProfit) : "",// O: 実利益(¥)
    product.listingPrice != null ? `$${product.listingPrice.toFixed(2)}` : "", // P: 出品価格($)
    product.weight != null ? String(product.weight) : "",            // Q: 重量(g)
    product.marketAvgJpy != null ? String(product.marketAvgJpy) : "", // R: 落札相場平均(¥)
    product.marketMinJpy != null ? String(product.marketMinJpy) : "", // S: 落札相場最安(¥)
    product.marketMaxJpy != null ? String(product.marketMaxJpy) : "", // T: 落札相場最高(¥)
    product.ebayUrl ?? "",                                            // U: eBay URL
    product.sourceUrl ?? "",                                          // V: 仕入先URL
    product.notes ?? "",                                              // W: メモ
    product.listingTitle ?? "",                                       // X: 出品タイトル
    product.ebayCondition ?? "",                                      // Y: コンディション
    product.ebayCategoryId ?? "",                                     // Z: カテゴリID
    product.ebayCategoryPath ?? "",                                   // AA: カテゴリ名
    product.listingDescription
      ? product.listingDescription.slice(0, 1000)
      : "",                                                           // AB: 説明文
    product.imageUrls && product.imageUrls.length > 0
      ? product.imageUrls.slice(0, 20).join(",")
      : "",                                                           // AC: 写真URL
    product.listingItemSpecifics ?? "",                              // AD: ItemSpecifics(JSON)
  ];
}

// Append new row to セドリリスト. Returns the 1-based row index of the appended row.
export async function appendProductToSheet(
  spreadsheetId: string,
  sheetName: string,
  product: ProductForSheet
): Promise<number | null> {
  const sheets = await getUncachableGoogleSheetClient();
  await ensureSheetExists(spreadsheetId, sheetName);

  const row = buildSheetRow(product);

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!${SEDORI_RANGE}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });

  // Extract row number from updated range e.g. "セドリリスト!A5:T5"
  const updatedRange = res.data.updates?.updatedRange;
  if (updatedRange) {
    const match = updatedRange.match(/!A(\d+):/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

// Update an existing row in セドリリスト by 1-based row index.
export async function updateProductInSheet(
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  product: ProductForSheet
): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();
  await ensureSheetExists(spreadsheetId, sheetName);

  const row = buildSheetRow(product);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowIndex}:AD${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

// ---- Mercari-eBay 在庫管理シート (A~E only) ----
export async function ensureInventorySheetExists(spreadsheetId: string, sheetName: string) {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets || [];
  const sheetExists = existingSheets.some(
    (s) => s.properties?.title === sheetName
  );

  if (!sheetExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName,
              gridProperties: { rowCount: 1000, columnCount: 10 },
            },
          },
        }],
      },
    });

    // Add headers matching the existing sheet structure
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:E1`,
      valueInputOption: "RAW",
      requestBody: { values: [["Mercari URL", "eBay URL", "仕入値(円)", "売値(USD)", "利益率(%)"]] },
    });
  }
  return sheetExists;
}

// Append to Mercari-eBay 在庫管理 (A:E only, F-H managed by external tool)
export async function appendToInventorySheet(
  spreadsheetId: string,
  sheetName: string,
  product: {
    sourceUrl?: string | null;
    ebayUrl?: string | null;
    sourcePrice?: number | null;
    listingPrice?: number | null;
    profitRate?: number | null;
  }
): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();
  await ensureInventorySheetExists(spreadsheetId, sheetName);

  const row = [
    product.sourceUrl ?? "",
    product.ebayUrl ?? "",
    product.sourcePrice != null ? String(product.sourcePrice) : "",
    product.listingPrice != null ? String(product.listingPrice) : "",
    product.profitRate != null ? `${product.profitRate.toFixed(1)}%` : "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

// Read all rows from セドリリスト and return as structured objects
export async function readSheetProducts(spreadsheetId: string, sheetName: string): Promise<Array<Record<string, string>>> {
  const sheets = await getUncachableGoogleSheetClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AD`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0] as string[];
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (row[i] as string) || ""; });
    return obj;
  }).filter((r) => r["商品名"]); // skip empty rows
}

export async function getSpreadsheetInfo(spreadsheetId: string) {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  return {
    title: spreadsheet.data.properties?.title,
    sheets: spreadsheet.data.sheets?.map((s) => s.properties?.title),
  };
}

// Force-update headers in the セドリリスト sheet (repairs existing sheets)
export async function updateSheetHeaders(spreadsheetId: string, sheetName: string): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();
  await ensureSheetExists(spreadsheetId, sheetName);

  // Overwrite row 1 with latest headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:AD1`,
    valueInputOption: "RAW",
    requestBody: { values: [SEDORI_HEADERS] },
  });

  const sheetId = await getSheetId(spreadsheetId, sheetName);
  if (sheetId !== null) {
    // Apply color-coded group formatting
    await applySheetHeaderFormatting(sheets, spreadsheetId, sheetId);

    // Auto-resize all columns
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 30 },
          },
        }],
      },
    });
  }
}
