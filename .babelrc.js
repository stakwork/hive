module.exports = {
  presets: ['next/babel'],
  plugins: process.env.NODE_ENV === 'development' ? [
    '@babel/plugin-transform-react-jsx-source',
    '@react-dev-inspector/babel-plugin'
  ] : []
};