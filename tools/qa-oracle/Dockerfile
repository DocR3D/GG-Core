FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY GGCore.QaOracle.csproj ./
RUN dotnet restore
COPY QaOraclePlugin.cs ./
RUN dotnet publish -c Release -o /out --no-restore

FROM scratch AS export
COPY --from=build /out/ /
