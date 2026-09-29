require("dotenv").config();
const { queryTrack123 } = require("./track123");

(async () => {
  try {
    // A dummy tracking number just to confirm auth works (expect a "rejected"/empty result, not an auth error)
    const result = await queryTrack123(["TESTTRACKINGNUMBER123"]);
    console.log("Success, result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
  }
})();
