module.exports = /* GraphQL */ `
  mutation DeleteProduct($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
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
