/**
 * GraphQL query for fetching metaobjects for a specific type
 */

const FETCH_METAOBJECTS = `#graphql
query GetMetaobjects($type: String!) {
  metaobjects(type: $type, first: 100) {
    edges {
      node {
        id
        handle
        type
        displayName
        fields {
          key
          value
          type
          reference {
            ... on MediaImage {
              image {
                url
              }
            }
            ... on Metaobject {
              id
              handle
              type
            }
          }
        }
        capabilities {
          publishable {
            status
          }
        }
      }
    }
  }
}
`;

module.exports = FETCH_METAOBJECTS;
