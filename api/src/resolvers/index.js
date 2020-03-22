
const { GraphQLScalarType } = require('graphql')
const { authorizeWithGitHub } = require('../auth.js')
// const { uploadStream } = require ('../lib') // not yet obvious why do we need that. I assume that's a missing part in the book
require('dotenv').config()

const fetch = require('node-fetch')
const path = require('path')

const resolvers = {
  Query: {
    me: (parent, args, { currentUser }) => currentUser,

    totalPhotos: (parent, args, { db }) =>
      db.collection('photos')
        .estimatedDocumentCount(),

    allPhotos: (parent, args, { db }) =>
      db.collection('photos')
        .find()
        .toArray(),

    totalUsers: (parent, args, { db }) =>
      db.collection('users')
        .estimatedDocumentCount(),

    allUsers: (parent, args, { db }) =>
      db.collection('users')
        .find()
        .toArray()
  },

  Mutation: {
    async postPhoto(parent, args, { db, currentUser, pubsub }) {
      if (!currentUser) {
        throw new Error('only an authorized user can post a photo')
      }

      var newPhoto = {
        ...args.input,
        userID: currentUser.githubLogin,
        created: new Date()
      }

      const { insertedIds } = await db.collection('photos').insert(newPhoto)
      newPhoto.id = insertedIds[0]

      var toPath = path.join(
        __dirname, '..', 'assets', 'photos', `${newPhoto.id}.jpg`
      )

      const { stream } = await args.input.file
      await uploadFile(input.file, toPath)

      pubsub.publish('photo-added', { newPhoto })

      return newPhoto
    },

    async githubAuth(parent, { code }, { db, pubsub }) {
      let {
        message,
        access_token,
        avatar_url,
        login,
        name
      } = await authorizeWithGitHub({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_SECRET,
        code
      })

      if (message) {
        throw new Error(message)
      }

      let latestUserInfo = {
        name,
        githubLogin: login,
        githubToken: access_token,
        avatar: avatar_url
      }

      const { ops:[user], result } = await db
        .collection('users')
        .replaceOne({ githubLogin: login }, latestUserInfo, { upsert: true })

      result.upserted && pubsub.publish('user-added', { newUser: user })

      return { user, token: access_token }
    },

    fakeUserAuth: async (parent, { githubLogin }, { db }) => {
      var user = await db.collection('users').findOne({ githubLogin })

      if (!user) {
        throw new Error(`Cannot find user with githubLogin "${githubLogin}"`)
      }

      return {
        token: user.githubToken,
        user
      }
    },

    addFakeUsers: async (root, { count }, { db, pubsub }) => {
      var randomUserApi = `https://randomuser.me/api/?results=${count}`

      var { results } = await fetch(randomUserApi)
        .then(res => res.json())

      var users = results.map(r => ({
        githubLogin: r.login.username,
        name: `${r.name.first} ${r.name.last}`,
        avatar: r.picture.thumbnail,
        githubToken: r.login.sha1
      }))

      await db.collection('users').insert(users)

      users.forEach((newUser) => pubsub.publish('user-added', { newUser }))

      return users
    }
  },

  Subscription: {
    newPhoto: {
      subscribe: (parent, args, { pubsub }) =>
        pubsub.asyncIterator('photo-added')
    },
    newUser: {
      subscribe: (parent, args, { pubsub }) =>
        pubsub.asyncIterator('user-added')
    }
  },

  Photo: {
    id: parent => parent.id || parent._id,

    url: parent => `img/photos/${parent._id}.jpg`,

    postedBy: (parent, args, { db }) =>
      db.collection('users').findOne({ githubLogin: parent.userID }),

    taggedUsers: parent => tags
      .filter(tag => tag.photoID === parent.id)
      .map(tag => tag.userID)
      .map(userID => users.find(u => u.githubLogin == userID))
  },

  User: {
    postedPhotos: parent => {
      return photos.filter(p => p.githubUser === parent.githubLogin)
    },
    inPhotos: parent => tags
      .filter(tag => tag.userID === parent.id)
      .map(tag => tag.photoID)
      .map(photoID = photos.find(p => p.id === photoID))
  },

  DateTime: new GraphQLScalarType({
    name: 'DateTime',
    description: 'A valid date time value.',
    parseValue: value => new Date(value),
    serialize: value => new Date(value).toISOString(),
    parseLiteral: ast => ast.value
  })
}

module.exports = resolvers