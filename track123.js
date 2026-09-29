const TRACK123_API_URL = "https://api.track123.com/gateway/open-api/tk/v2.1/track/query";

async function queryTrack123(trackingNumbers) {
  if (!trackingNumbers.length) {
    return [];
  }

  const response = await fetch(TRACK123_API_URL, {
    method: "POST",
    headers: {
      "Track123-Api-Secret": process.env.TRACK123_API_SECRET,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      trackNoInfos: trackingNumbers.map(trackNo => ({ trackNo })),
    }),
  });

  const data = await response.json();

  if (data.code !== "00000") {
    throw new Error(`Track123 error: ${data.msg || JSON.stringify(data)}`);
  }

  return data.data.accepted.content;
}

module.exports = { queryTrack123 };
