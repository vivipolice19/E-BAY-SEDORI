import type { AppSettings } from "@shared/schema";
import { normalizeEbayCategoryId } from "@shared/ebayCategory";
import { pickTrimmedCredential } from "./ebayClient";

export { normalizeEbayCategoryId };

export function resolveListingAuth(settings: AppSettings) {
  return {
    appId: pickTrimmedCredential(process.env.EBAY_APP_ID, settings.ebayAppId),
    certId: pickTrimmedCredential(process.env.EBAY_CERT_ID, settings.ebayCertId),
    devId: pickTrimmedCredential(process.env.EBAY_DEV_ID, settings.ebayDevId),
    userToken: pickTrimmedCredential(process.env.EBAY_USER_TOKEN, settings.ebayUserToken),
  };
}

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** CDATA 内に ]]> が含まれると壊れるため分割 */
export function sanitizeForCdata(htmlOrText: string): string {
  return (htmlOrText || "").replace(/\]\]>/g, "]] >");
}

function isNumericPolicyId(v: string | null | undefined): boolean {
  return !!(v && /^\d+$/.test(v.trim()));
}

export interface AddItemBody {
  title: string;
  description: string;
  categoryId: string;
  price: number;
  condition: string;
  specifics?: Record<string, string>;
  imageUrls?: string[];
  weight?: number;
  dispatchDays?: number;
}

export function buildTradingAddItemXml(settings: AppSettings, body: AddItemBody): string {
  const { title, description, price, condition, specifics, imageUrls, dispatchDays } = body;
  const { userToken: TOKEN } = resolveListingAuth(settings);

  const conditionMap: Record<string, { id: string; name: string }> = {
    New: { id: "1000", name: "New" },
    "Like New": { id: "3000", name: "Like New" },
    "Very Good": { id: "4000", name: "Very Good" },
    Good: { id: "5000", name: "Good" },
    Acceptable: { id: "6000", name: "Acceptable" },
    "For Parts or Not Working": { id: "7000", name: "For Parts or Not Working" },
    Used: { id: "3000", name: "Used" },
  };
  const condObj = conditionMap[condition] || { id: "3000", name: "Used" };

  const cat = normalizeEbayCategoryId(body.categoryId);
  if (!cat) throw new Error("eBayカテゴリIDが不正です。数字のカテゴリIDのみ指定できます（eBayから取得で補完してください）。");

  const nameValueList = specifics
    ? Object.entries(specifics)
        .map(
          ([k, v]) =>
            `<NameValueList><Name>${escapeXmlText(k)}</Name><Value>${escapeXmlText(String(v))}</Value></NameValueList>`,
        )
        .join("")
    : "";

  const pictureUrls = (imageUrls || []).slice(0, 12).map((url) => `<PictureURL>${escapeXmlText(url)}</PictureURL>`).join("");

  const dispatchD = dispatchDays ?? settings.ebayDispatchDays ?? 3;
  const location = settings.ebayLocation || "Japan";

  const payId = (settings.ebayPaymentPolicy || "").trim();
  const retId = (settings.ebayReturnPolicy || "").trim();
  const shipId = (settings.ebayShippingPolicy || "").trim();
  const useBusinessPolicies = isNumericPolicyId(payId) && isNumericPolicyId(retId) && isNumericPolicyId(shipId);

  const sellerProfilesBlock = useBusinessPolicies
    ? `<SellerProfiles>
    <SellerPaymentProfile><PaymentProfileID>${payId}</PaymentProfileID></SellerPaymentProfile>
    <SellerReturnProfile><ReturnProfileID>${retId}</ReturnProfileID></SellerReturnProfile>
    <SellerShippingProfile><ShippingProfileID>${shipId}</ShippingProfileID></SellerShippingProfile>
  </SellerProfiles>`
    : "";

  const legacyShippingReturn = useBusinessPolicies
    ? ""
    : `<ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <InternationalShippingServiceOption>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>StandardInternationalShipping</ShippingService>
        <ShippingServiceCost currencyID="USD">0.00</ShippingServiceCost>
        <ShipToLocation>Worldwide</ShipToLocation>
      </InternationalShippingServiceOption>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>`;

  const descSafe = sanitizeForCdata(description || "");

  return `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${escapeXmlText(TOKEN)}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${escapeXmlText(title.slice(0, 80))}</Title>
    <Description><![CDATA[${descSafe}]]></Description>
    <PrimaryCategory>
      <CategoryID>${cat}</CategoryID>
    </PrimaryCategory>
    <StartPrice>${price.toFixed(2)}</StartPrice>
    <ConditionID>${condObj.id}</ConditionID>
    <ConditionDescription>${escapeXmlText(condObj.name)}</ConditionDescription>
    <Country>JP</Country>
    <Location>${escapeXmlText(location)}</Location>
    <Currency>USD</Currency>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <DispatchTimeMax>${dispatchD}</DispatchTimeMax>
    <Quantity>1</Quantity>
    ${pictureUrls ? `<PictureDetails>${pictureUrls}</PictureDetails>` : ""}
    <ItemSpecifics>${nameValueList}</ItemSpecifics>
    ${sellerProfilesBlock}
    ${legacyShippingReturn}
  </Item>
</AddItemRequest>`;
}
