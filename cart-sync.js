const { shopifyGraphql } = require("./loyalty");

const METAFIELD_NAMESPACE = "app_cart";
const METAFIELD_KEY = "items";

async function findCustomerId(accessToken, email) {
  const query = `
    query findCustomer($queryString: String!) {
      customers(first: 1, query: $queryString) {
        nodes { id }
      }
    }
  `;

  const data = await shopifyGraphql(accessToken, query, {
    queryString: `email:${email}`,
  });

  return data.customers.nodes[0]?.id || null;
}

async function getCart(accessToken, email) {
  const customerId = await findCustomerId(accessToken, email);

  if (!customerId) {
    return [];
  }

  const query = `
    query getCart($id: ID!) {
      customer(id: $id) {
        metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
          value
        }
      }
    }
  `;

  const data = await shopifyGraphql(accessToken, query, { id: customerId });
  const raw = data.customer?.metafield?.value;

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function setCart(accessToken, email, items) {
  const customerId = await findCustomerId(accessToken, email);

  if (!customerId) {
    throw new Error(`No Shopify customer found for ${email}`);
  }

  const mutation = `
    mutation setCart($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphql(accessToken, mutation, {
    metafields: [
      {
        ownerId: customerId,
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(items),
      },
    ],
  });

  const result = data.metafieldsSet;

  if (result.userErrors.length > 0) {
    throw new Error(`Failed to save cart: ${JSON.stringify(result.userErrors)}`);
  }

  return items;
}

module.exports = { getCart, setCart };
