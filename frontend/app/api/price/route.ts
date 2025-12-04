import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const API_KEY = 'c498f9b09e6942858c7557f6d0e65adc';
        const url = 'https://pro-api.coinmarketcap.com/v1/tools/price-conversion?amount=1&symbol=ZEC&convert=MINA';

        const response = await fetch(url, {
            headers: {
                'X-CMC_PRO_API_KEY': API_KEY,
            },
        });

        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch price' }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
