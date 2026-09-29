const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const {
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
} = process.env;

async function getShopifyAccessToken() {
  const url =
    `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }),
  });

  const text = await response.text();

  console.log("SHOPIFY STATUS:", response.status);
  console.log("SHOPIFY RESPONSE:", text);

  if (!response.ok) {
    throw new Error(
      `Shopify authentication failed: ${response.status} - ${text}`
    );
  }

  const data = JSON.parse(text);

  return data.access_token;
}

app.get("/", (req, res) => {
  res.json({
    message: "Shopify mobile backend is running",
  });
});

app.get("/api/test-shopify", async (req, res) => {
  try {
    const accessToken = await getShopifyAccessToken();

    res.json({
      success: true,
      message: "Successfully authenticated with Shopify",
      tokenReceived: !!accessToken,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const accessToken = await getShopifyAccessToken();

    const query = `
      query {
        products(first: 20) {
          nodes {
            id
            title
            handle
            status
            description
            featuredImage {
              url
              altText
            }
            variants(first: 10) {
              nodes {
                id
                title
                price
                availableForSale
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Shopify products error:", data);

      return res.status(response.status).json({
        success: false,
        error: data,
      });
    }

    if (data.errors) {
      return res.status(400).json({
        success: false,
        errors: data.errors,
      });
    }

    res.json({
      success: true,
      products: data.data.products.nodes,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


app.post("/api/orders", async (req, res) => {
  try {
    const accessToken = await getShopifyAccessToken();

    const {
      email,
      firstName,
      lastName,
      variantId,
      quantity = 1,
      shippingAddress,
    } = req.body;

    if (!variantId) {
      return res.status(400).json({
        success: false,
        message: "variantId is required",
      });
    }

    const mutation = `
      mutation orderCreate($order: OrderCreateOrderInput!) {
        orderCreate(order: $order) {
          order {
            id
            name
            email
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 10) {
              nodes {
                title
                quantity
                variant {
                  id
                  title
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      order: {
        email,
        lineItems: [
          {
            variantId,
            quantity: Number(quantity),
          },
        ],
      },
    };

    if (shippingAddress) {
      variables.order.shippingAddress = {
        firstName: shippingAddress.firstName || firstName,
        lastName: shippingAddress.lastName || lastName,
        address1: shippingAddress.address1,
        address2: shippingAddress.address2,
        city: shippingAddress.city,
        province: shippingAddress.province,
        country: shippingAddress.country,
        zip: shippingAddress.zip,
        phone: shippingAddress.phone,
      };
    }

    const response = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data,
      });
    }

    if (data.errors) {
      return res.status(400).json({
        success: false,
        errors: data.errors,
      });
    }

    const result = data.data.orderCreate;

    if (result.userErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: result.userErrors,
      });
    }

    return res.json({
      success: true,
      order: result.order,
    });
  } catch (error) {
    console.error("Create order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/orders/:orderId/cancel", async (req, res) => {
  try {
    const accessToken = await getShopifyAccessToken();

    const { orderId } = req.params;

    const {
      notifyCustomer = true,
      restock = true,
      refund = false,
      reason = "CUSTOMER",
      staffNote = "Cancelled from mobile app",
    } = req.body;

    // Accept either the numeric Shopify order ID
    // or the full gid://shopify/Order/... format.
    const shopifyOrderId = orderId.startsWith("gid://")
      ? orderId
      : `gid://shopify/Order/${orderId}`;

    const mutation = `
      mutation OrderCancel(
        $orderId: ID!,
        $notifyCustomer: Boolean,
        $refundMethod: OrderCancelRefundMethodInput,
        $restock: Boolean!,
        $reason: OrderCancelReason!,
        $staffNote: String
      ) {
        orderCancel(
          orderId: $orderId,
          notifyCustomer: $notifyCustomer,
          refundMethod: $refundMethod,
          restock: $restock,
          reason: $reason,
          staffNote: $staffNote
        ) {
          job {
            id
            done
          }
          orderCancelUserErrors {
            field
            message
            code
          }
        }
      }
    `;

    const variables = {
      orderId: shopifyOrderId,
      notifyCustomer,
      restock,
      reason,
      staffNote,
    };

    // Only request a refund when refund=true
    if (refund) {
      variables.refundMethod = {
        originalPaymentMethodsRefund: true,
      };
    }

    const response = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data,
      });
    }

    if (data.errors) {
      return res.status(400).json({
        success: false,
        errors: data.errors,
      });
    }

    const result = data.data.orderCancel;

    if (result.orderCancelUserErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: result.orderCancelUserErrors,
      });
    }

    return res.json({
      success: true,
      message: "Order cancellation started",
      job: result.job,
    });
  } catch (error) {
    console.error("Cancel order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});