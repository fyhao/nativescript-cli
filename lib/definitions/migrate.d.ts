interface IMigrateController {
	migrate(migrateData: IProjectDir): Promise<void>;
	shouldMigrate(data: IProjectDir): Promise<boolean>;
	validate(data: IProjectDir): Promise<void>;
}

interface IDependency {
	packageName: string;
	isDev?: boolean;
}

interface IMigrationDependency extends IDependency {
	shouldRemove?: boolean;
	replaceWith?: string;
	warning?: string;
	verifiedVersion?: string;
	getVerifiedVersion?: (projectData: IProjectData) => Promise<string>;
	shouldAddIfMissing?: boolean;
	shouldMigrateAction?: (projectData: IProjectData) => Promise<boolean>;
	migrateAction?: (projectData: IProjectData, migrationBackupDirPath: string) => Promise<IMigrationDependency[]>;
}