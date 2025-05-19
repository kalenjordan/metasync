/**
 * GraphQL query for fetching metaobject definitions with a specific type
 */

const FETCH_METAOBJECT_DEFINITIONS = `#graphql
query FetchMetaobjectDefinitions($type: String) {
  metaobjectDefinitions(first: 100, filter: {type: $type}) {
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

module.exports = FETCH_METAOBJECT_DEFINITIONS;
