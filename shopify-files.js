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
    throw new Error(
      `Shopify GraphQL request failed: ${JSON.stringify(data.errors || data)}`
    );
  }

  return data.data;
}

async function uploadFileToShopify(accessToken, { buffer, filename, mimeType }) {
  const stagedUploadsMutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const stagedData = await shopifyGraphql(accessToken, stagedUploadsMutation, {
    input: [
      {
        filename,
        mimeType,
        httpMethod: "POST",
        resource: "FILE",
      },
    ],
  });

  const stagedResult = stagedData.stagedUploadsCreate;

  if (stagedResult.userErrors.length > 0) {
    throw new Error(
      `Staged upload failed: ${JSON.stringify(stagedResult.userErrors)}`
    );
  }

  const target = stagedResult.stagedTargets[0];

  const form = new FormData();
  for (const param of target.parameters) {
    form.append(param.name, param.value);
  }
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: form,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`File upload to Shopify storage failed: ${text}`);
  }

  const fileCreateMutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          ... on GenericFile {
            url
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const fileData = await shopifyGraphql(accessToken, fileCreateMutation, {
    files: [
      {
        alt: filename,
        contentType: "FILE",
        originalSource: target.resourceUrl,
      },
    ],
  });

  const fileResult = fileData.fileCreate;

  if (fileResult.userErrors.length > 0) {
    throw new Error(`File create failed: ${JSON.stringify(fileResult.userErrors)}`);
  }

  const fileId = fileResult.files[0].id;

  const fileQuery = `
    query($id: ID!) {
      node(id: $id) {
        ... on GenericFile {
          url
          fileStatus
        }
      }
    }
  `;

  let url = fileResult.files[0].url;

  for (let attempt = 0; attempt < 5 && !url; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 800));
    const polled = await shopifyGraphql(accessToken, fileQuery, { id: fileId });
    url = polled.node?.url;
  }

  if (!url) {
    throw new Error("File uploaded but Shopify has not finished processing it yet");
  }

  return { fileId, url };
}

module.exports = { uploadFileToShopify };
