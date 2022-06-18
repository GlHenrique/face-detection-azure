/* eslint-disable no-console */
/* eslint-disable no-shadow */
/* eslint-disable no-promise-executor-return */
const msRest = require('@azure/ms-rest-js');
const Face = require('@azure/cognitiveservices-face');
const { v4: uuid } = require('uuid');

const key = '58c769a14d9e4d06b09b4d5f3d839204';
const endpoint = 'https://reconhecimento-facial-azure.cognitiveservices.azure.com/';

const credentials = new msRest.ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': key } });
const client = new Face.FaceClient(credentials, endpoint);

const imageBaseUrl = 'https://csdx.blob.core.windows.net/resources/Face/Images/';
const personGroupId = uuid();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function DetectFaceRecognize(url) {
  // Detect faces from image URL. Since only recognizing, use the recognition model 4.
  // We use detection model 3 because we are only retrieving the qualityForRecognition attribute.
  // Result faces with quality for recognition lower than "medium" are filtered out.
  const detectedFaces = await client.face.detectWithUrl(
    url,
    {
      detectionModel: 'detection_03',
      recognitionModel: 'recognition_04',
      returnFaceAttributes: ['QualityForRecognition'],
    },
  );
  return detectedFaces.filter((face) => face.faceAttributes.qualityForRecognition === 'high' || face.faceAttributes.qualityForRecognition === 'medium');
}

async function AddFacesToPersonGroup(personDictionary, personGroupId) {
  console.log('Adding faces to person group...');
  // The similar faces will be grouped into a single person group person.

  await Promise.all(Object.keys(personDictionary).map(async (key) => {
    const value = personDictionary[key];

    // Wait briefly so we do not exceed rate limits.
    await sleep(2000);
    await sleep(2000);
    await sleep(2000);
    await sleep(2000);

    const person = await client.personGroupPerson.create(personGroupId, { name: key });
    console.log(`Create a persongroup person: ${key}.`);

    // Add faces to the person group person.
    await Promise.all(value.map(async (similarImage) => {
      // Check if the image is of sufficent quality for recognition.
      let sufficientQuality = true;
      const detectedFaces = await client.face.detectWithUrl(
        imageBaseUrl + similarImage,
        {
          returnFaceAttributes: ['QualityForRecognition'],
          detectionModel: 'detection_03',
          recognitionModel: 'recognition_03',
        },
      );
      detectedFaces.forEach((detectedFace) => {
        if (detectedFace.faceAttributes.qualityForRecognition !== 'high') {
          sufficientQuality = false;
        }
      });

      // Quality is sufficent, add to group.
      if (sufficientQuality) {
        console.log(`Add face to the person group person: (${key}) from image: ${similarImage}.`);
        await client
          .personGroupPerson
          .addFaceFromUrl(personGroupId, person.personId, imageBaseUrl + similarImage);
      }
    }));
  }));

  console.log('Done adding faces to person group.');
}

async function WaitForPersonGroupTraining(personGroupId) {
  // Wait so we do not exceed rate limits.
  console.log('Waiting 10 seconds...');
  await sleep(10000);
  const result = await client.personGroup.getTrainingStatus(personGroupId);
  console.log(`Training status: ${result.status}.`);
  if (result.status !== 'succeeded') {
    await WaitForPersonGroupTraining(personGroupId);
  }
}

/* NOTE This function might not work with the free tier of the Face service
because it might exceed the rate limits. If that happens, try inserting calls
to sleep() between calls to the Face service.
*/
async function IdentifyInPersonGroup() {
  console.log('========IDENTIFY FACES========');
  console.log();

  // Create a dictionary for all your images, grouping similar ones under the same key.
  const personDictionary = {
    'Family1-Dad': ['Family1-Dad1.jpg', 'Family1-Dad2.jpg'],
    'Family1-Mom': ['Family1-Mom1.jpg', 'Family1-Mom2.jpg'],
    'Family1-Son': ['Family1-Son1.jpg', 'Family1-Son2.jpg'],
    'Family1-Daughter': ['Family1-Daughter1.jpg', 'Family1-Daughter2.jpg'],
    'Family2-Lady': ['Family2-Lady1.jpg', 'Family2-Lady2.jpg'],
    'Family2-Man': ['Family2-Man1.jpg', 'Family2-Man2.jpg'],
  };

  // A group photo that includes some of the persons you seek to identify from your dictionary.
  const sourceImageFileName = 'identification1.jpg';

  // Create a person group.
  console.log(`Creating a person group with ID: ${personGroupId}`);
  await client.personGroup.create(personGroupId, personGroupId, { recognitionModel: 'recognition_04' });

  await AddFacesToPersonGroup(personDictionary, personGroupId);

  // Start to train the person group.
  console.log();
  console.log(`Training person group: ${personGroupId}.`);
  await client.personGroup.train(personGroupId);

  await WaitForPersonGroupTraining(personGroupId);
  console.log();

  // Detect faces from source image url and only take those with sufficient quality for recognition.
  const faceIds = (
    await DetectFaceRecognize(imageBaseUrl + sourceImageFileName))
    .map((face) => face.faceId);
  // Identify the faces in a person group.
  const results = await client.face.identify(faceIds, { personGroupId });
  await Promise.all(results.map(async (result) => {
    const person = await client.personGroupPerson.get(personGroupId, result.candidates[0].personId);
    console.log(`Person: ${person.name} is identified for face in: ${sourceImageFileName} with ID: ${result.faceId}. Confidence: ${result.candidates[0].confidence}.`);
  }));
  console.log();
}

async function main() {
  await IdentifyInPersonGroup();
  console.log('Done.');
}
main();
