export function shouldUseRiggedDog(locationLike, params) {
  const { hostname = '', pathname = '' } = locationLike || {};
  const isLocal = hostname === '127.0.0.1' || hostname === 'localhost'
    || hostname === '[::1]' || hostname === '::1';
  const isAllgritPages = hostname === 'allgrit.github.io';
  const isProduction = pathname === '/agility-rush' || pathname.startsWith('/agility-rush/');
  const isStaging = pathname === '/agility-rush-staging'
    || pathname.startsWith('/agility-rush-staging/');

  return (isAllgritPages && (isProduction || isStaging))
    || (isLocal && params?.get('riggedDog') === '1');
}
