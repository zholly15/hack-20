/* eslint-disable promise/always-return */
/* eslint-disable promise/catch-or-return */
const functions = require("firebase-functions");
const firebase = require("firebase-admin");
const express = require("express");
const { request, response } = require("express");
const engines = require("consolidate");
const { body,validationResult } = require('express-validator/check');
const sanitizeBody = require('express-validator/filter');

const firebaseApp = firebase.initializeApp(functions.config().firebase);

function getFacts() {
  const ref = firebaseApp.database().ref("facts");
  return ref.once("value").then((snap) => snap.val());
}

const app = express();
app.engine("hbs", engines.handlebars);
app.set("views", "./views");
app.set("view engine", "hbs");

app.get("/", (request, response) => {
  response.render("index");
});

app.get("/aboutUs", (request, response) => {
  response.render("aboutus");
});

app.get("/communities", (request, response) => {
  response.render("communities");
});

app.get("/resources", (request, response) => {
  response.render("resources");
});

app.get("/contact", (request, response) => {
  getFacts().then((facts) => {
    response.render("findex", { facts });
  });
});

app.get("/chat", (request, response) => {
    response.render("chat");
  });

const Vision = require("@google-cloud/vision");
const vision = new Vision();
const spawn = require("child-process-promise").spawn;

const path = require("path");
const os = require("os");
const fs = require("fs");

// Adds a message that welcomes new users into the chat.
exports.addWelcomeMessages = functions.auth.user().onCreate(async (user) => {
  console.log("A new user signed in for the first time.");
  const fullName = user.displayName || "Anonymous";

  // Saves the new welcome message into the database
  // which then displays it in the FriendlyChat clients.
  await admin
    .firestore()
    .collection("messages")
    .add({
      name: "Firebase Bot",
      profilePicUrl: "/images/firebase-logo.png", // Firebase logo
      text: `${fullName} signed in for the first time! Welcome!`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  console.log("Welcome message written to database.");
});

// Blurs the given image located in the given bucket using ImageMagick.
async function blurImage(filePath) {
  const tempLocalFile = path.join(os.tmpdir(), path.basename(filePath));
  const messageId = filePath.split(path.sep)[1];
  const bucket = admin.storage().bucket();

  // Download file from bucket.
  await bucket.file(filePath).download({ destination: tempLocalFile });
  console.log("Image has been downloaded to", tempLocalFile);
  // Blur the image using ImageMagick.
  await spawn("convert", [
    tempLocalFile,
    "-channel",
    "RGBA",
    "-blur",
    "0x24",
    tempLocalFile,
  ]);
  console.log("Image has been blurred");
  // Uploading the Blurred image back into the bucket.
  await bucket.upload(tempLocalFile, { destination: filePath });
  console.log("Blurred image has been uploaded to", filePath);
  // Deleting the local file to free up disk space.
  fs.unlinkSync(tempLocalFile);
  console.log("Deleted local file.");
  // Indicate that the message has been moderated.
  await admin
    .firestore()
    .collection("messages")
    .doc(messageId)
    .update({ moderated: true });
  console.log("Marked the image as moderated in the database.");
}

// Checks if uploaded images are flagged as Adult or Violence and if so blurs them.
exports.blurOffensiveImages = functions
  .runWith({ memory: "2GB" })
  .storage.object()
  .onFinalize(async (object) => {
    const image = {
      source: { imageUri: `gs://${object.bucket}/${object.name}` },
    };

    // Check the image content using the Cloud Vision API.
    const batchAnnotateImagesResponse = await vision.safeSearchDetection(image);
    const safeSearchResult =
      batchAnnotateImagesResponse[0].safeSearchAnnotation;
    const Likelihood = Vision.types.Likelihood;
    if (
      Likelihood[safeSearchResult.adult] >= Likelihood.LIKELY ||
      Likelihood[safeSearchResult.violence] >= Likelihood.LIKELY
    ) {
      console.log(
        "The image",
        object.name,
        "has been detected as inappropriate."
      );
      return blurImage(object.name);
    }
    console.log("The image", object.name, "has been detected as OK.");
  });

// Sends a notifications to all users when a new message is posted.
exports.sendNotifications = functions.firestore
  .document("messages/{messageId}")
  .onCreate(async (snapshot) => {
    // Notification details.
    const text = snapshot.data().text;
    const payload = {
      notification: {
        title: `${snapshot.data().name} posted ${
          text ? "a message" : "an image"
        }`,
        body: text
          ? text.length <= 100
            ? text
            : text.substring(0, 97) + "..."
          : "",
        icon:
          snapshot.data().profilePicUrl || "/images/profile_placeholder.png",
        click_action: `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com`,
      },
    };

    // Get the list of device tokens.
    const allTokens = await admin.firestore().collection("fcmTokens").get();
    const tokens = [];
    allTokens.forEach((tokenDoc) => {
      tokens.push(tokenDoc.id);
    });

    if (tokens.length > 0) {
      // Send notifications to all tokens.
      const response = await admin.messaging().sendToDevice(tokens, payload);
      await cleanupTokens(response, tokens);
      console.log("Notifications have been sent and tokens cleaned up.");
    }
  });
// Cleans up the tokens that are no longer valid.
function cleanupTokens(response, tokens) {
  // For each notification we check if there was an error.
  const tokensDelete = [];
  response.results.forEach((result, index) => {
    const error = result.error;
    if (error) {
      console.error("Failure sending notification to", tokens[index], error);
      // Cleanup the tokens who are not registered anymore.
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        const deleteTask = admin
          .firestore()
          .collection("fcmTokens")
          .doc(tokens[index])
          .delete();
        tokensDelete.push(deleteTask);
      }
    }
  });
  return Promise.all(tokensDelete);
}

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
let map;

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: -34.397, lng: 150.644 },
    zoom: 8
  });
}

exports.app = functions.https.onRequest(app);
