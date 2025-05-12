module.exports = /* GraphQL */ `
  mutation DeleteCollection($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      shop {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;
