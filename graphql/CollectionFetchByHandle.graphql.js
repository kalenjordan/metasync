const logger = require("../utils/Logger");
/**
 * GraphQL query to fetch a collection by its handle
 */
module.exports = `#graphql
  query GetCollectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
      description
      descriptionHtml
      seo {
        title
        description
      }
      image {
        id
        url
        altText
      }
      templateSuffix
      sortOrder
      updatedAt
      ruleSet {
        rules {
          column
          condition
          relation
          conditionObject {
            ... on CollectionRuleMetafieldCondition {
              metafieldDefinition {
                id
                namespace
                key
                ownerType
              }
            }
          }
        }
        appliedDisjunctively
      }
      publications(first: 25) {
        edges {
          node {
            channel {
              id
              handle
              name
            }
            isPublished
            publishDate
          }
        }
      }
      metafields(first: 50) {
        edges {
          node {
            id
            namespace
            key
            type
            value
            definition {
              id
              namespace
              key
              ownerType
              type {
                name
              }
            }
          }
        }
      }
    }
  }
`;
