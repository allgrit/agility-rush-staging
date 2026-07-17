export function shouldUseRiggedDog(locationLike, params) {
  const { hostname = '', pathname = '' } = locationLike || {};
  const isLocal = hostname === '127.0.0.1' || hostname === 'localhost'
    || hostname === '[::1]' || hostname === '::1';
  const isAllgritPages = hostname === 'allgrit.github.io';
  const isProduction = pathname === '/agility-rush' || pathname.startsWith('/agility-rush/');
  const isStaging = pathname === '/agility-rush-staging'
    || pathname.startsWith('/agility-rush-staging/');
  // VK Games (VK Mini App) хостится на нашем поддомене — rigged-бордер штатно, как в проде.
  const isVKHost = hostname === 'agility-rush.tsdpu.org';

  return (isAllgritPages && (isProduction || isStaging))
    || isVKHost
    || (isLocal && params?.get('riggedDog') === '1');
}
