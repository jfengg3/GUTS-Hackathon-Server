const processFile = require("../middleware/upload");
const { format, isBuffer } = require("util");

const { Storage } = require("@google-cloud/storage");

const storage = new Storage({ keyFilename: "google-cloud-key.json" });
const bucket = storage.bucket("testgcs01");

const upload = async (req, res) => {
  try {
    await processFile(req, res);

    if (!req.file) {
      return res.status(400).send({ message: "Please upload a file!" });
    }

    const blob = bucket.file(req.file.originalname);
    const blobStream = blob.createWriteStream({
      resumable: false,
    });

    blobStream.on("error", (err) => {
      res.status(500).send({ message: err.message });
    });

    blobStream.on("finish", async (data) => {
      const publicUrl = format(
        `https://storage.googleapis.com/${bucket.name}/${blob.name}`
      );

      try {
        await bucket.file(req.file.originalname).makePublic();
      } catch {
        return res.status(500).send({
          message: `Uploaded the file successfully: ${req.file.originalname}, but public access is denied!`,
          url: publicUrl,
        });
      }

      res.status(200).send({
        message: "Uploaded the file successfully: " + req.file.originalname,
        url: publicUrl,
      });

      fileToText(publicUrl);
    });

    blobStream.end(req.file.buffer);
  } catch (err) {
    console.log(err);

    if (err.code == "LIMIT_FILE_SIZE") {
      return res.status(500).send({
        message: "File size cannot be larger than 2MB!",
      });
    }

    res.status(500).send({
      message: `Could not upload the file: ${req.file.originalname}. ${err}`,
    });
  }
};

const getListFiles = async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    let fileInfos = [];

    files.forEach((file) => {
      fileInfos.push({
        name: file.name,
        url: file.metadata.mediaLink,
      });
    });

    res.status(200).send(fileInfos);
  } catch (err) {
    console.log(err);

    res.status(500).send({
      message: "Unable to read list of files!",
    });
  }
};

const download = async (req, res) => {
  try {
    const [metaData] = await bucket.file(req.params.name).getMetadata();
    res.redirect(metaData.mediaLink);
  } catch (err) {
    res.status(500).send({
      message: "Could not download the file. " + err,
    });
  }
};

module.exports = {
  upload,
  getListFiles,
  download,
};

function fileToText(audioUrl) {
  require("dotenv").config();
  const fetch = require("node-fetch");
  const url = "https://api.assemblyai.com/v2/transcript";

  let args = process.argv.slice(2);
  //let audioUrl = args[0];
  const data = {
    audio_url: audioUrl,
    filter_profanity: true
  };

  const params = {
    headers: {
      authorization: "26a21340c6be4f54a507b605d36c7e7b",
      "content-type": "application/json",
    },
    body: JSON.stringify(data),
    method: "POST",
  };

  fetch(url, params)
    .then((response) => response.json())
    .then((data) => {
      console.log("Success:", data);
      console.log("ID:", data["id"]);

      downloadText(data["id"]);
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

function downloadText(id) {
  require("dotenv").config();
  const fetch = require("node-fetch");

  const url = `https://api.assemblyai.com/v2/transcript/${id}`;

  const params = {
    headers: {
      authorization: "26a21340c6be4f54a507b605d36c7e7b",
      "content-type": "application/json",
    },
    method: "GET",
  };

  function getStatusLoop(){
    var status;
    console.log('transcribing...');
    fetch(url,params)
    .then((response) => response.json())
    .then((data) => {
      status = data.status;
      if (status != "completed") {
        setTimeout(function () {
          return getStatusLoop();
        }, 4000);
      } else {
        console.log('Completed transcribing. ' + status + ' ' + data.text);

        if(data.text.includes("*")){
          console.log('Audio file contains profanity, removing from the database.');

          // If audio file contains profanity, we'll remove from our database
          async function deleteAudio() {
            let audio_url = data["audio_url"];
            await bucket.file(audio_url.substring(audio_url.lastIndexOf('/') + 1)).delete();
            console.log('Deleted');
          }
          
          deleteAudio().catch(console.error);

        }
      }
    })

    
  }

  getStatusLoop();
  

  // fetch(url, params)
  //   .then((response) => response.json())
  //   .then((data) => {
  //     function print() {
  //       console.log('looped');
  //       if(data.status != "completed"){
  //         setTimeout(function(){
  //           return print();
  //         }, 1000);
  //       }
  //         switch (data.status) {
  //         case "queued":
  //         case "processing":
  //           console.log(
  //             "AssemblyAI is still transcribing your audio, please try again in a few minutes!"
  //           );
  //           break;
  //         case "completed":
  //           console.log(`Success: ${data}`);
  //           console.log(`Text: ${data.text}`);
  //           break;
  //         default:
  //           console.log(`Something went wrong :-( : ${data.status}`);
  //           break;
  //       }
  //     }
  //     print();
  //   })
  //   .catch((error) => {
  //     console.error(`Error: ${error}`);
  //   });
}
