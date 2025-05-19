/**
 * GraphQL query for fetching all metaobject definitions
 */

const FETCH_ALL_METAOBJECT_DEFINITIONS = `#graphql
query FetchAllMetaobjectDefinitions {
  metaobjectDefinitions(first: 100) {
    nodes {
      id
      type
      name
      description
      fieldDefinitions {
        key
        name
        description
        required
        type {
          name
        }
        validations {
          name
          value
        }
      }
      capabilities {
        publishable {
          enabled
        }
      }
      access {
        admin
        storefront
      }
    }
  }
}
`;

module.exports = FETCH_ALL_METAOBJECT_DEFINITIONS;
