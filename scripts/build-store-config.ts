
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, serverTimestamp, type DocumentData } from 'firebase-admin/firestore';

// In the Studio environment, service account credentials are automatically provided.
initializeApp();
const db = getFirestore();

/**
 * Fetches all documents from a collection and maps them to an array, including the document ID.
 */
async function fetchCollection(collectionPath: string): Promise<DocumentData[]> {
    const snapshot = await db.collection(collectionPath).get();
    if (snapshot.empty) {
        return [];
    }
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}


async function main() {
    console.log("Starting store config build script...");

    // --- 1. Parse CLI Arguments ---
    const args = process.argv.slice(2).reduce((acc, arg) => {
        const [key, value] = arg.split('=');
        acc[key.replace('--', '')] = value;
        return acc;
    }, {} as Record<string, string>);

    const storeId = args.storeId;
    const isDryRun = args.dryRun === 'true';

    if (!storeId) {
        console.error("\n❌ Error: --storeId=<your-store-id> is a required argument.");
        process.exit(1);
    }

    console.log(`\nStore ID: ${storeId}`);
    console.log(`Mode: ${isDryRun ? 'Dry Run (read-only)' : 'Live Write'}`);

    try {
        // --- 2. Read all source collections ---
        console.log("\nFetching source data...");
        const [
            tables,
            storePackages,
            storeFlavors,
            menuSchedules
        ] = await Promise.all([
            fetchCollection(`stores/${storeId}/tables`),
            fetchCollection(`stores/${storeId}/storePackages`),
            fetchCollection(`stores/${storeId}/storeFlavors`),
            fetchCollection(`stores/${storeId}/menuSchedules`),
        ]);
        console.log(`  - Found ${tables.length} tables.`);
        console.log(`  - Found ${storePackages.length} packages.`);
        console.log(`  - Found ${storeFlavors.length} flavors.`);
        console.log(`  - Found ${menuSchedules.length} schedules.`);

        // --- 3. Prepare the new config document ---
        const configDocRef = db.doc(`stores/${storeId}/storeConfig/current`);
        let currentVersion = 0;

        try {
            const existingConfigSnap = await configDocRef.get();
            if (existingConfigSnap.exists) {
                currentVersion = existingConfigSnap.data()?.meta?.version || 0;
            }
        } catch (e) {
            console.warn("Could not read existing config doc, assuming version 0.");
        }
        
        const nextVersion = currentVersion + 1;
        console.log(`\nBuilding config document version: ${nextVersion}`);

        const newConfigData = {
            meta: {
                version: nextVersion,
                updatedAt: serverTimestamp(),
                source: 'build-store-config-v1'
            },
            tables,
            packages: storePackages,
            flavors: storeFlavors,
            schedules: menuSchedules,
        };

        // --- 4. Perform write or dry run ---
        if (isDryRun) {
            console.log("\n--- DRY RUN ---");
            console.log("The following data would be written to:");
            console.log(` -> ${configDocRef.path}`);
            console.log("\nSample Data:");
            console.log(`- ${newConfigData.tables.length} tables (e.g., ID: ${newConfigData.tables[0]?.id || 'N/A'})`);
            console.log(`- ${newConfigData.packages.length} packages (e.g., ID: ${newConfigData.packages[0]?.packageId || 'N/A'})`);
            console.log("\nNo data was written to the database.");
        } else {
            console.log("\nWriting to Firestore...");
            await configDocRef.set(newConfigData);
            console.log(`✅ Successfully wrote config document to: ${configDocRef.path}`);
        }

    } catch (error) {
        console.error("\n❌ An unexpected error occurred:", error);
        process.exit(1);
    }
    
    console.log("\nScript finished.");
}

main();
