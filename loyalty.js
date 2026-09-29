const POINTS_PER_CURRENCY_UNIT = 100; // 1 point per 100 LKR spent
const METAFIELD_NAMESPACE = "loyalty";
const METAFIELD_KEY = "points";

const { SHOPIFY_STORE_DOMAIN } = process.env;

async function shopifyGraphql(accessToken, query, variables) {
  const response = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const data = await response.json();

  if (!response.ok || data.errors) {
    throw new Error(`Shopify GraphQL request failed: ${JSON.stringify(data.errors || data)}`);
  }

  return data.data;
}

async function findCustomerByEmail(accessToken, email) {
  const query = `
    query findCustomer($queryString: String!) {
      customers(first: 1, query: $queryString) {
        nodes {
          id
          metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
            value
          }
        }
      }
    }
  `;

  const data = await shopifyGraphql(accessToken, query, {
    queryString: `email:${email}`,
  });

  return data.customers.nodes[0] || null;
}

async function getPointsBalance(accessToken, email) {
  const customer = await findCustomerByEmail(accessToken, email);

  if (!customer) {
    return 0;
  }

  return customer.metafield ? parseInt(customer.metafield.value, 10) : 0;
}

async function setPointsBalance(accessToken, customerId, newBalance) {
  const mutation = `
    mutation setPoints($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id value }
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
        type: "number_integer",
        value: String(newBalance),
      },
    ],
  });

  const result = data.metafieldsSet;

  if (result.userErrors.length > 0) {
    throw new Error(`Failed to set points: ${JSON.stringify(result.userErrors)}`);
  }

  return newBalance;
}

async function awardPointsForOrder(accessToken, { email, totalPrice }) {
  if (!email || !totalPrice) {
    return null;
  }

  const pointsEarned = Math.floor(Number(totalPrice) / POINTS_PER_CURRENCY_UNIT);

  if (pointsEarned <= 0) {
    return null;
  }

  const customer = await findCustomerByEmail(accessToken, email);

  if (!customer) {
    console.warn(`Loyalty: no Shopify customer found for ${email}, skipping points award`);
    return null;
  }

  const currentBalance = customer.metafield ? parseInt(customer.metafield.value, 10) : 0;
  const newBalance = currentBalance + pointsEarned;

  await setPointsBalance(accessToken, customer.id, newBalance);

  return { pointsEarned, newBalance };
}

module.exports = {
  getPointsBalance,
  awardPointsForOrder,
  POINTS_PER_CURRENCY_UNIT,
  shopifyGraphql,
};
