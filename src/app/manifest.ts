import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SharEat Hub',
    short_name: 'SharEat',
    description: 'A complete POS, KDS, and ERP solution for restaurants.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#f5a623',
    icons: [
      {
        src: '/logo-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/logo-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
